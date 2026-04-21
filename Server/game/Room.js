class Room {
  constructor(id, { boardSize = 10, winCount, winDirections, maxPlayers, timePerTurn } = {}, roomManager) {
    this.id = id;
    this.players = [];
    this.turn = null;
    this.boardSize = boardSize;
    this.winCount = winCount || this.calculateWinCount(boardSize);
    this.winDirections = winDirections || ["horizontal", "vertical", "diagonal"];
    this.maxPlayers = Math.max(2, parseInt(maxPlayers) || 999);
    this.board = Array(boardSize * boardSize).fill("");
    this.roomManager = roomManager;

    const rawTime = parseInt(timePerTurn) || 30;
    this.timePerTurn = Math.min(60, Math.max(5, rawTime));
    this.timeLeft = this.timePerTurn;
    this.timer = null;
    this.countdownTimer = null;
    this.io = null;

    this.started = false;
    this.lastMoveTime = 0;
    this.lastActive = Date.now();
    this.gameOver = false;
    this.statsUpdated = false;

    this.symbolPool = ["X", "O", "△", "□", "★", "♦", "♠", "♥", "⬟", "⬡"];
    this.iconPool = {};
  }

  calculateWinCount(size) {
    if (size <= 5) return 3;
    if (size <= 9) return 4;
    return 5;
  }

  attachIO(io) { this.io = io; }

  getPlayersInfo() {
    return this.players.map(p => ({
      playerId: p.playerId,
      symbol: p.symbol,
      icon: p.icon || null,
      color: p.color || null,
      connected: p.connected,
      ready: p.ready || false,
      username: p.username || null,
    }));
  }

  addPlayer(socket, playerId, icon, color) {
    if (!playerId) return false;
    let existing = this.players.find(p => p.playerId === playerId);

    if (this.players.length >= this.maxPlayers && !existing) return false;

    if (existing) {
      existing.socket = socket;
      existing.connected = true;
      existing.userId = socket.userId || existing.userId || null;
      existing.username = socket.username || existing.username || null;
      if (existing.disconnectTimer) { clearTimeout(existing.disconnectTimer); existing.disconnectTimer = null; }
      socket.join(this.id);
      socket.symbol = existing.symbol;
      socket.icon = existing.icon;
      socket.color = existing.color;
      this.lastActive = Date.now();
      socket.emit("reconnectSuccess", {
        board: this.board, turn: this.turn, timeLeft: this.timeLeft,
        yourSymbol: existing.symbol, yourIcon: existing.icon, yourColor: existing.color,
        started: this.started, gameOver: this.gameOver,
        boardSize: this.boardSize, winCount: this.winCount,
        winDirections: this.winDirections, maxPlayers: this.maxPlayers,
        timePerTurn: this.timePerTurn,
        players: this.getPlayersInfo(),
      });
      if (this.io) this.io.to(this.id).emit("playerReconnected", { symbol: existing.symbol, players: this.getPlayersInfo() });
      return true;
    }

    const usedSymbols = this.players.map(p => p.symbol);
    const symbol = this.symbolPool.find(s => !usedSymbols.includes(s)) || `P${this.players.length + 1}`;

    const player = {
      socket,
      symbol,
      playerId,
      userId: socket.userId || null,
      username: socket.username || null,
      icon: icon || null,
      color: color || null,
      connected: true,
      disconnectTimer: null,
      ready: false,
    };

    this.players.push(player);
    socket.join(this.id);
    socket.symbol = symbol;
    socket.icon = icon || null;
    socket.color = color || null;
    this.lastActive = Date.now();
    return true;
  }

  setReady(socket, io) {
    const player = this.players.find(p => p.socket && p.socket.id === socket.id);
    if (!player) return;
    player.ready = true;

    const allReady = this.players.length >= 2 && this.players.every(p => p.ready);
    io.to(this.id).emit("playerReadyUpdate", { players: this.getPlayersInfo(), allReady });
  }

  cancelReady(socket, io) {
    if (this.started) return;
    const player = this.players.find(p => p.socket && p.socket.id === socket.id);
    if (!player || !player.ready) return;
    player.ready = false;

    const allReady = this.players.length >= 2 && this.players.every(p => p.ready);
    io.to(this.id).emit("playerReadyUpdate", { players: this.getPlayersInfo(), allReady });
  }

  hostStart(socket, io) {
    if (!this.players[0] || this.players[0].playerId !== socket.playerId) return false;
    const allReady = this.players.length >= 2 && this.players.every(p => p.ready);
    if (!allReady || this.started) return false;

    this.started = true;
    this.gameOver = false;
    this.statsUpdated = false;

    const _io = io || this.io;
    if (!_io) return false;

    let count = 5;
    _io.to(this.id).emit("countdown", { count });

    this.countdownTimer = setInterval(() => {
      count--;
      if (count > 0) {
        _io.to(this.id).emit("countdown", { count });
      } else {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;

        this.turn = this.players[0].symbol;
        this.board.fill("");

        _io.to(this.id).emit("gameStart", {
          turn: this.turn,
          time: this.timePerTurn,
          players: this.getPlayersInfo(),
        });

        this.startTimer();
      }
    }, 1000);

    return true;
  }

  hasPlayer(socket) {
    return this.players.some(p => p.socket && p.socket.id === socket.id);
  }

  startTimer() {
    clearInterval(this.timer);
    this.timeLeft = this.timePerTurn;

    this.timer = setInterval(() => {
      if (this.gameOver) { clearInterval(this.timer); return; }
      this.timeLeft--;
      if (this.io) this.io.to(this.id).emit("timerUpdate", { timeLeft: this.timeLeft, turn: this.turn });

      if (this.timeLeft <= 0) {
        clearInterval(this.timer);
        if (this.gameOver) return;

        const skippedSymbol = this.turn;
        this.turn = this._nextTurn(this.turn);

        if (this.io) this.io.to(this.id).emit("turnSkipped", { skipped: skippedSymbol, turn: this.turn });

        this.startTimer();
      }
    }, 1000);
  }

  stopTimer() {
    clearInterval(this.timer);
    this.timer = null;
  }

  _nextTurn(currentSymbol) {
    const connectedPlayers = this.players.filter(p => p.connected);
    if (connectedPlayers.length === 0) return currentSymbol;
    const idx = connectedPlayers.findIndex(p => p.symbol === currentSymbol);
    return connectedPlayers[(idx + 1) % connectedPlayers.length].symbol;
  }

  makeMove(socket, index) {
    const now = Date.now();
    if (this.gameOver || !this.started) return null;
    if (!this.hasPlayer(socket)) return null;
    if (!Number.isInteger(index)) return null;
    if (index < 0 || index >= this.board.length) return null;
    if (now - this.lastMoveTime < 200) return null;
    if (socket.symbol !== this.turn) return null;
    if (this.board[index] !== "") return null;

    this.lastMoveTime = now;
    this.lastActive = now;
    this.board[index] = socket.symbol;

    const winCells = this.checkWin(index, socket.symbol);
    const win = !!winCells;
    let draw = false;

    if (win) {
      clearInterval(this.timer);
      this.gameOver = true;
      if (this.io) this.io.to(this.id).emit("gameOver", { winner: socket.symbol, reason: "win", winCells });
    } else if (this.board.every(c => c !== "")) {
      clearInterval(this.timer);
      this.gameOver = true;
      draw = true;
      if (this.io) this.io.to(this.id).emit("gameOver", { winner: null, reason: "draw" });
    } else {
      this.turn = this._nextTurn(this.turn);
      this.startTimer();
    }

    return {
      index, symbol: socket.symbol, icon: socket.icon || null,
      color: socket.color || null, turn: this.turn,
      timeLeft: this.timeLeft, win, draw, winCells,
    };
  }

  checkWin(index, symbol) {
    const size = this.boardSize;
    const row = Math.floor(index / size);
    const col = index % size;
    const dirs = this.winDirections;

    const allDirs = [
      { name: "horizontal", dx: 1, dy: 0 },
      { name: "vertical",   dx: 0, dy: 1 },
      { name: "diagonal",   dx: 1, dy: 1 },
      { name: "diagonal",   dx: 1, dy: -1 },
    ];

    for (const d of allDirs) {
      if (!dirs.includes(d.name)) continue;
      let cells = [[row, col]];
      cells.push(...this.collectDir(row, col, d.dx, d.dy, symbol));
      cells.push(...this.collectDir(row, col, -d.dx, -d.dy, symbol));

      const seen = new Set(); const unique = [];
      for (const [r, c] of cells) {
        const key = r + "," + c;
        if (!seen.has(key)) { seen.add(key); unique.push([r, c]); }
      }
      if (unique.length >= this.winCount) return unique.map(([r, c]) => r * size + c);
    }
    return null;
  }

  collectDir(r, c, dx, dy, symbol) {
    const res = [];
    r += dy; c += dx;
    while (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize && this.board[r * this.boardSize + c] === symbol) {
      res.push([r, c]); r += dy; c += dx;
    }
    return res;
  }

  removePlayer(socket) {
    const player = this.players.find(p => p.socket && p.socket.id === socket.id);
    if (!player) return;
    player.connected = false;
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = setTimeout(() => {
      if (player.connected) return;
      this.players = this.players.filter(p => p !== player);
      this.roomManager?.removePlayerCompletely(player.playerId);
      clearInterval(this.timer);
      if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
      const remaining = this.players.filter(p => p.connected);
      if (this.started && !this.gameOver && remaining.length >= 1 && this.io) {
        this.gameOver = true;
        const winner = remaining.length === 1 ? remaining[0].symbol : null;
        this.io.to(this.id).emit("gameOver", { winner, reason: "disconnect" });
      }
    }, 10000);
  }

  kickPlayer(hostSocket, targetPlayerId) {
    if (!this.players[0] || this.players[0].playerId !== hostSocket.playerId) return null;
    if (targetPlayerId === hostSocket.playerId) return null;
    if (this.started) return null;
    const target = this.players.find(p => p.playerId === targetPlayerId);
    if (!target) return null;
    this.players = this.players.filter(p => p.playerId !== targetPlayerId);
    this.roomManager?.removePlayerCompletely(targetPlayerId);
    return target;
  }

  isFull() { return this.players.length >= this.maxPlayers; }

  reset() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
    this.board.fill("");
    this.turn = this.players.length > 0 ? this.players[0].symbol : null;
    this.gameOver = false;
    this.started = false;
    this.statsUpdated = false;
    this.timeLeft = this.timePerTurn;
    this.lastMoveTime = 0;
    this.players.forEach(p => p.ready = false);
  }

  destroy() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
    for (const p of this.players) {
      if (p.disconnectTimer) { clearTimeout(p.disconnectTimer); p.disconnectTimer = null; }
    }
    this.io = null;
    this.roomManager = null;
  }
}

module.exports = Room;