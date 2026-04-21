require("dotenv").config();
const prisma = require("./prisma/client");

prisma.$connect()
  .then(() => console.log("✅ Database connected"))
  .catch(err => {
    console.error("❌ Database connection failed:", err);
    process.exit(1);
  });

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const RoomManager = require("./game/RoomManager");
const path = require("path");
const authRoutes = require("./routes/auth");
const friendRoutes = require("./routes/friends");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const roomManager = new RoomManager();

app.use(express.json());
app.use("/auth", authRoutes);

// Gắn io vào app để friendRoutes dùng được
app.set("io", io);
app.use("/friends", friendRoutes);

app.use(express.static(path.join(__dirname, "../Client")));

// ─────────────────────────────────────────
//  CÔNG THỨC ELO
// ─────────────────────────────────────────

function expectedScore(myElo, oppElo) {
  return 1 / (1 + Math.pow(10, (oppElo - myElo) / 400));
}

function kFactor(elo) {
  if (elo < 1200) return 32;
  if (elo < 2000) return 24;
  return 16;
}

function calcEloDelta(myElo, oppElo, score) {
  const E = expectedScore(myElo, oppElo);
  const K = kFactor(myElo);
  return Math.round(K * (score - E));
}

// ─────────────────────────────────────────
//  API BẢNG XẾP HẠNG — GET /leaderboard
// ─────────────────────────────────────────
app.get("/leaderboard", async (req, res) => {
  try {
    const top = await prisma.userStats.findMany({
      orderBy: { elo: "desc" },
      take: 20,
      include: {
        user: {
          select: { username: true, createdAt: true },
        },
      },
    });

    const result = top.map((s, index) => ({
      rank: index + 1,
      username: s.user.username,
      elo: s.elo,
      wins: s.wins,
      losses: s.losses,
      draws: s.draws,
      totalGames: s.wins + s.losses + s.draws,
      winRate:
        s.wins + s.losses + s.draws === 0
          ? 0
          : Math.round((s.wins / (s.wins + s.losses + s.draws)) * 100),
    }));

    return res.json(result);
  } catch (err) {
    console.error("Leaderboard error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});

// ─────────────────────────────────────────
//  SOCKET.IO MIDDLEWARE — Xác thực JWT
// ─────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    socket.userId = null;
    socket.username = null;
    socket.isGuest = true;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    socket.username = decoded.username;
    socket.isGuest = false;
    next();
  } catch (err) {
    socket.userId = null;
    socket.username = null;
    socket.isGuest = true;
    next();
  }
});

// ─────────────────────────────────────────
//  SOCKET.IO EVENTS
// ─────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("init", ({ playerId } = {}) => {
    socket.playerId = playerId || socket.id;
  });

  if (socket.userId) {
    socket.join("user_" + socket.userId);
  }

  // HOST TẠO PHÒNG
  socket.on("createRoom", ({ boardSize, winCount, winDirections, maxPlayers, timePerTurn, playerId, icon, color } = {}) => {
    const size = parseInt(boardSize);
    if (!size || size < 3 || size > 30) return;
    socket.playerId = playerId || socket.playerId || socket.id;
    roomManager.removePlayer(socket);
    const room = roomManager.createRoom({ boardSize: size, winCount, winDirections, maxPlayers, timePerTurn });
    room.attachIO(io);
    room.addPlayer(socket, socket.playerId, icon, color);
    roomManager.addPlayerToRoom(socket, room);
    socket.emit("roomCreated", {
      roomId: room.id, symbol: socket.symbol, icon: socket.icon,
      boardSize: room.boardSize, winCount: room.winCount,
      winDirections: room.winDirections, maxPlayers: room.maxPlayers,
      timePerTurn: room.timePerTurn,
      players: room.getPlayersInfo(),
      stats: roomManager.getStats(socket.playerId),
    });
    io.emit("roomListUpdate", roomManager.getPublicRooms());
  });

  // VÀO PHÒNG
  socket.on("joinRoom", ({ roomId, playerId, icon, color } = {}) => {
    if (typeof roomId !== "string" || !playerId) return;
    socket.playerId = playerId;
    const room = roomManager.getRoom(roomId);
    if (!room) { socket.emit("joinFailed", { reason: "Phòng không tồn tại!" }); return; }
    if (room.isFull()) { socket.emit("joinFailed", { reason: "Phòng đã đầy!" }); return; }
    if (room.started) { socket.emit("joinFailed", { reason: "Ván đấu đã bắt đầu!" }); return; }
    roomManager.removePlayer(socket);
    room.addPlayer(socket, playerId, icon, color);
    roomManager.addPlayerToRoom(socket, room);

    const joinedData = {
      roomId: room.id, symbol: socket.symbol, icon: socket.icon,
      boardSize: room.boardSize, winCount: room.winCount,
      winDirections: room.winDirections, maxPlayers: room.maxPlayers,
      timePerTurn: room.timePerTurn,
      waiting: true, currentTurn: room.turn, started: false,
      players: room.getPlayersInfo(), stats: roomManager.getStats(socket.playerId),
    };

    socket.emit("joined", joinedData);

    setImmediate(() => {
      io.to(room.id).emit("playerJoined", { players: room.getPlayersInfo() });
      io.emit("roomListUpdate", roomManager.getPublicRooms());
    });
  });

  // ĐỔI ICON
  socket.on("changeIcon", ({ roomId, icon } = {}) => {
    if (!roomId || !icon) return;
    const room = roomManager.getRoom(roomId);
    if (!room || room.started) return;
    const player = room.players.find(p => p.playerId === socket.playerId);
    if (!player) return;
    const taken = room.players.some(p => p.playerId !== socket.playerId && p.icon === icon);
    if (taken) { socket.emit("iconTaken", { icon }); return; }
    player.icon = icon;
    socket.icon = icon;
    io.to(roomId).emit("playerJoined", { players: room.getPlayersInfo() });
  });

  // ĐỔI MÀU
  socket.on("changeColor", ({ roomId, color } = {}) => {
    if (!roomId || !color) return;
    const room = roomManager.getRoom(roomId);
    if (!room || room.started) return;
    const player = room.players.find(p => p.playerId === socket.playerId);
    if (!player) return;
    player.color = color;
    socket.color = color;
    io.to(roomId).emit("playerJoined", { players: room.getPlayersInfo() });
  });

  // RESET SẴN SÀNG
  socket.on("resetReady", ({ roomId } = {}) => {
    if (typeof roomId !== "string") return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    room.reset();
    io.to(roomId).emit("playerReadyUpdate", { players: room.getPlayersInfo(), allReady: false });
    io.emit("roomListUpdate", roomManager.getPublicRooms());
  });

  // BẮT ĐẦU (chỉ host)
  socket.on("hostStart", ({ roomId } = {}) => {
    if (typeof roomId !== "string") return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    room.hostStart(socket, io);
    io.emit("roomListUpdate", roomManager.getPublicRooms());
  });

  // SẴN SÀNG
  socket.on("playerReady", ({ roomId } = {}) => {
    if (typeof roomId !== "string") return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    room.setReady(socket, io);
    io.emit("roomListUpdate", roomManager.getPublicRooms());
  });

  // HỦY SẴN SÀNG
  socket.on("cancelReady", ({ roomId } = {}) => {
    if (typeof roomId !== "string") return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    room.cancelReady(socket, io);
    io.emit("roomListUpdate", roomManager.getPublicRooms());
  });

  // KICK NGƯỜI CHƠI (chỉ host)
  socket.on("kickPlayer", ({ roomId, targetPlayerId } = {}) => {
    if (typeof roomId !== "string" || !targetPlayerId) return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    const kicked = room.kickPlayer(socket, targetPlayerId);
    if (!kicked) return;
    if (kicked.socket) {
      kicked.socket.emit("kicked", { reason: "Bạn đã bị chủ phòng kick!" });
      kicked.socket.leave(roomId);
    }
    io.to(roomId).emit("playerJoined", { players: room.getPlayersInfo() });
    io.emit("roomListUpdate", roomManager.getPublicRooms());
  });

  // CHAT
  socket.on("chatMsg", ({ roomId, text } = {}) => {
    if (!roomId || !text || typeof text !== "string") return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    const player = room.players.find(p => p.playerId === socket.playerId);
    if (!player) return;
    const msg = { symbol: player.symbol, icon: player.icon, text: text.slice(0, 100), time: Date.now() };
    io.to(roomId).emit("chatMsg", msg);
  });

  // ĐẦU HÀNG
  socket.on("surrender", ({ roomId } = {}) => {
    if (!roomId) return;
    const room = roomManager.getRoom(roomId);
    if (!room || !room.started || room.gameOver) return;
    const loser = room.players.find(p => p.playerId === socket.playerId);
    if (!loser) return;
    const winner = room.players.find(p => p.playerId !== socket.playerId);
    room.gameOver = true;
    room.stopTimer();
    io.to(roomId).emit("gameOver", { winner: winner?.symbol || null, reason: "surrender", loser: loser.symbol });
  });

  // CHỦ ĐỘNG THOÁT PHÒNG
  socket.on("leaveRoom", ({ roomId } = {}) => {
    if (!roomId) return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const leaver = room.players.find(p => p.playerId === socket.playerId);
    if (!leaver) return;

    if (room.started && !room.gameOver) {
      const winner = room.players.find(p => p.playerId !== socket.playerId);
      room.gameOver = true;
      room.stopTimer();
      if (room.countdownTimer) { clearInterval(room.countdownTimer); room.countdownTimer = null; }
      io.to(roomId).emit("gameOver", {
        winner: winner?.symbol || null,
        reason: "disconnect",
        leaver: leaver.symbol,
      });
    }

    if (leaver.disconnectTimer) { clearTimeout(leaver.disconnectTimer); leaver.disconnectTimer = null; }
    room.players = room.players.filter(p => p.playerId !== socket.playerId);
    roomManager.removePlayerCompletely(socket.playerId);
    socket.leave(roomId);

    if (room.players.length === 0) {
      room.destroy();
      delete roomManager.rooms[roomId];
    }

    io.emit("roomListUpdate", roomManager.getPublicRooms());
  });

  // ĐI QUÂN
  socket.on("makeMove", ({ roomId, index } = {}) => {
    if (typeof roomId !== "string") return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    const result = room.makeMove(socket, index);
    if (!result) return;
    io.to(roomId).emit("moveMade", result);
  });

  // ─────────────────────────────────────────
  //  KẾT THÚC VÁN — GHI STATS + TÍNH ELO
  // ─────────────────────────────────────────
  socket.on("gameOverHandled", async ({ roomId, winner, reason } = {}) => {
    if (typeof roomId !== "string") return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    if (room.statsUpdated) return;
    room.statsUpdated = true;

    const loggedInPlayers = room.players.filter(p => p.userId);

    try {
      if (reason === "win" && loggedInPlayers.length === 2) {
        const [statsA, statsB] = await Promise.all(
          loggedInPlayers.map(p =>
            prisma.userStats.findUnique({ where: { userId: p.userId } })
          )
        );

        if (statsA && statsB) {
          const [pA, pB] = loggedInPlayers;
          const isAWinner = pA.symbol === winner;

          const scoreA = isAWinner ? 1 : 0;
          const scoreB = isAWinner ? 0 : 1;

          const deltaA = calcEloDelta(statsA.elo, statsB.elo, scoreA);
          const deltaB = calcEloDelta(statsB.elo, statsA.elo, scoreB);

          const newEloA = Math.max(100, statsA.elo + deltaA);
          const newEloB = Math.max(100, statsB.elo + deltaB);

          await Promise.all([
            prisma.userStats.update({
              where: { userId: pA.userId },
              data: {
                wins:   isAWinner ? { increment: 1 } : undefined,
                losses: !isAWinner ? { increment: 1 } : undefined,
                elo: newEloA,
              },
            }),
            prisma.userStats.update({
              where: { userId: pB.userId },
              data: {
                wins:   !isAWinner ? { increment: 1 } : undefined,
                losses: isAWinner ? { increment: 1 } : undefined,
                elo: newEloB,
              },
            }),
          ]);

          for (const p of loggedInPlayers) {
            const isWinner = p.symbol === winner;
            const delta = p.userId === pA.userId ? deltaA : deltaB;
            const newElo = p.userId === pA.userId ? newEloA : newEloB;
            if (p.socket) {
              p.socket.emit("eloUpdate", { delta, newElo, isWinner });
            }
          }
        }
      }

      else if (reason === "win" && loggedInPlayers.length === 1) {
        const p = loggedInPlayers[0];
        const stats = await prisma.userStats.findUnique({ where: { userId: p.userId } });
        if (stats) {
          const isWinner = p.symbol === winner;
          const delta = calcEloDelta(stats.elo, 1000, isWinner ? 1 : 0);
          const newElo = Math.max(100, stats.elo + delta);
          await prisma.userStats.update({
            where: { userId: p.userId },
            data: {
              wins:   isWinner ? { increment: 1 } : undefined,
              losses: !isWinner ? { increment: 1 } : undefined,
              elo: newElo,
            },
          });
          if (p.socket) {
            p.socket.emit("eloUpdate", { delta, newElo, isWinner });
          }
        }
      }

      else if (reason === "draw") {
        if (loggedInPlayers.length === 2) {
          const [statsA, statsB] = await Promise.all(
            loggedInPlayers.map(p =>
              prisma.userStats.findUnique({ where: { userId: p.userId } })
            )
          );
          if (statsA && statsB) {
            const [pA, pB] = loggedInPlayers;
            const deltaA = calcEloDelta(statsA.elo, statsB.elo, 0.5);
            const deltaB = calcEloDelta(statsB.elo, statsA.elo, 0.5);
            const newEloA = Math.max(100, statsA.elo + deltaA);
            const newEloB = Math.max(100, statsB.elo + deltaB);

            await Promise.all([
              prisma.userStats.update({
                where: { userId: pA.userId },
                data: { draws: { increment: 1 }, elo: newEloA },
              }),
              prisma.userStats.update({
                where: { userId: pB.userId },
                data: { draws: { increment: 1 }, elo: newEloB },
              }),
            ]);

            for (const p of loggedInPlayers) {
              const delta = p.userId === pA.userId ? deltaA : deltaB;
              const newElo = p.userId === pA.userId ? newEloA : newEloB;
              if (p.socket) {
                p.socket.emit("eloUpdate", { delta, newElo, isWinner: false, isDraw: true });
              }
            }
          }
        } else {
          for (const p of loggedInPlayers) {
            await prisma.userStats.update({
              where: { userId: p.userId },
              data: { draws: { increment: 1 } },
            });
          }
        }
      }

      else if (reason === "surrender" || reason === "disconnect") {
        if (loggedInPlayers.length === 2) {
          const [statsA, statsB] = await Promise.all(
            loggedInPlayers.map(p =>
              prisma.userStats.findUnique({ where: { userId: p.userId } })
            )
          );
          if (statsA && statsB) {
            const [pA, pB] = loggedInPlayers;
            const isAWinner = pA.symbol === winner;
            const deltaA = calcEloDelta(statsA.elo, statsB.elo, isAWinner ? 1 : 0);
            const deltaB = calcEloDelta(statsB.elo, statsA.elo, isAWinner ? 0 : 1);
            const newEloA = Math.max(100, statsA.elo + deltaA);
            const newEloB = Math.max(100, statsB.elo + deltaB);

            await Promise.all([
              prisma.userStats.update({
                where: { userId: pA.userId },
                data: {
                  wins:   isAWinner ? { increment: 1 } : undefined,
                  losses: !isAWinner ? { increment: 1 } : undefined,
                  elo: newEloA,
                },
              }),
              prisma.userStats.update({
                where: { userId: pB.userId },
                data: {
                  wins:   !isAWinner ? { increment: 1 } : undefined,
                  losses: isAWinner ? { increment: 1 } : undefined,
                  elo: newEloB,
                },
              }),
            ]);

            for (const p of loggedInPlayers) {
              const isWinner = p.symbol === winner;
              const delta = p.userId === pA.userId ? deltaA : deltaB;
              const newElo = p.userId === pA.userId ? newEloA : newEloB;
              if (p.socket) {
                p.socket.emit("eloUpdate", { delta, newElo, isWinner });
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("gameOverHandled error:", err);
    }
  });

  // KẾT NỐI LẠI
  socket.on("reconnectToRoom", ({ roomId, playerId } = {}) => {
    if (typeof roomId !== "string" || !playerId) { socket.emit("reconnectFailed", { reason: "invalid" }); return; }
    socket.playerId = playerId;
    socket.reconnecting = true;
    const room = roomManager.getRoom(roomId);
    if (!room) { socket.emit("reconnectFailed", { reason: "room_not_found" }); return; }
    const success = room.addPlayer(socket, playerId);
    if (success) { roomManager.addPlayerToRoom(socket, room); socket.join(room.id); }
    else socket.emit("reconnectFailed", { reason: "cannot_rejoin" });
  });

  socket.on("getRoomList", () => {
    socket.emit("roomList", roomManager.getPublicRooms());
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    roomManager.removePlayer(socket);
    io.emit("roomListUpdate", roomManager.getPublicRooms());
  });
});

const PORT = process.env.PORT || 8386;
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
process.on("SIGINT",  () => { roomManager.destroy(); server.close(() => process.exit(0)); });
process.on("SIGTERM", () => { roomManager.destroy(); server.close(() => process.exit(0)); });