// =============================================================================
//  FRIENDS ROUTE — Server/routes/friends.js
//  Tất cả API liên quan đến kết bạn
// =============================================================================

const express = require("express");
const router = express.Router();
const prisma = require("../prisma/client");
const authMiddleware = require("../middleware/authMiddleware");

// Helper: lấy io từ app (được gắn trong Server.js)
function getIO(req) { return req.app.get("io"); }

// ─────────────────────────────────────────
//  TÌM KIẾM NGƯỜI DÙNG THEO ID — GET /friends/search?id=5
//  Trả về thông tin cơ bản + trạng thái quan hệ
// ─────────────────────────────────────────
router.get("/search", authMiddleware, async (req, res) => {
  const targetId = parseInt(req.query.id);
  const myId = req.user.userId;

  if (!targetId || isNaN(targetId))
    return res.status(400).json({ message: "ID không hợp lệ" });

  if (targetId === myId)
    return res.status(400).json({ message: "Không thể tìm kiếm chính mình" });

  try {
    const user = await prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        username: true,
        createdAt: true,
        stats: { select: { elo: true, wins: true, losses: true, draws: true } },
      },
    });

    if (!user) return res.status(404).json({ message: "Không tìm thấy người dùng #" + targetId });

    // Kiểm tra quan hệ hiện tại giữa 2 người
    const friendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { senderId: myId,     receiverId: targetId },
          { senderId: targetId, receiverId: myId     },
        ],
      },
    });

    let relationStatus = "none"; // none | pending_sent | pending_received | friends
    if (friendship) {
      if (friendship.status === "accepted") {
        relationStatus = "friends";
      } else if (friendship.status === "pending") {
        relationStatus = friendship.senderId === myId ? "pending_sent" : "pending_received";
      }
    }

    return res.json({ ...user, relationStatus, friendshipId: friendship?.id || null });
  } catch (err) {
    console.error("Search user error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});

// ─────────────────────────────────────────
//  GỬI LỜI MỜI KẾT BẠN — POST /friends/request
// ─────────────────────────────────────────
router.post("/request", authMiddleware, async (req, res) => {
  const myId = req.user.userId;
  const { receiverId } = req.body;

  if (!receiverId || receiverId === myId)
    return res.status(400).json({ message: "receiverId không hợp lệ" });

  try {
    // Kiểm tra người nhận tồn tại
    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, username: true },
    });
    if (!receiver) return res.status(404).json({ message: "Người dùng không tồn tại" });

    // Kiểm tra đã có quan hệ chưa
    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { senderId: myId,       receiverId },
          { senderId: receiverId, receiverId: myId },
        ],
      },
    });

    if (existing) {
      if (existing.status === "accepted")
        return res.status(400).json({ message: "Đã là bạn bè rồi" });
      if (existing.status === "pending")
        return res.status(400).json({ message: "Lời mời đang chờ xử lý" });
    }

    const friendship = await prisma.friendship.create({
      data: { senderId: myId, receiverId },
    });

    // Lấy thông tin người gửi để notify realtime
    const sender = await prisma.user.findUnique({
      where: { id: myId },
      select: { id: true, username: true },
    });

    // Realtime: notify cho người nhận nếu đang online
    const io = getIO(req);
    if (io) {
      io.to("user_" + receiverId).emit("friendRequest", {
        friendshipId: friendship.id,
        from: { id: sender.id, username: sender.username },
      });
    }

    return res.json({ message: "Đã gửi lời mời kết bạn!", friendshipId: friendship.id });
  } catch (err) {
    console.error("Friend request error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});

// ─────────────────────────────────────────
//  CHẤP NHẬN LỜI MỜI — POST /friends/accept
// ─────────────────────────────────────────
router.post("/accept", authMiddleware, async (req, res) => {
  const myId = req.user.userId;
  const { friendshipId } = req.body;

  if (!friendshipId)
    return res.status(400).json({ message: "Thiếu friendshipId" });

  try {
    const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });

    if (!friendship)
      return res.status(404).json({ message: "Không tìm thấy lời mời" });
    if (friendship.receiverId !== myId)
      return res.status(403).json({ message: "Không có quyền chấp nhận" });
    if (friendship.status !== "pending")
      return res.status(400).json({ message: "Lời mời đã được xử lý rồi" });

    await prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: "accepted" },
    });

    // Lấy tên người nhận để notify người gửi
    const receiver = await prisma.user.findUnique({
      where: { id: myId },
      select: { id: true, username: true },
    });

    const io = getIO(req);
    if (io) {
      io.to("user_" + friendship.senderId).emit("friendAccepted", {
        friendshipId,
        by: { id: receiver.id, username: receiver.username },
      });
    }

    return res.json({ message: "Đã chấp nhận lời mời kết bạn!" });
  } catch (err) {
    console.error("Accept friend error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});

// ─────────────────────────────────────────
//  TỪ CHỐI / HỦY LỜI MỜI — POST /friends/decline
//  Dùng cho cả: từ chối lời mời nhận được, hoặc hủy lời mời đã gửi
// ─────────────────────────────────────────
router.post("/decline", authMiddleware, async (req, res) => {
  const myId = req.user.userId;
  const { friendshipId } = req.body;

  if (!friendshipId)
    return res.status(400).json({ message: "Thiếu friendshipId" });

  try {
    const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });

    if (!friendship)
      return res.status(404).json({ message: "Không tìm thấy lời mời" });

    // Chỉ người gửi hoặc người nhận mới được hủy/từ chối
    if (friendship.senderId !== myId && friendship.receiverId !== myId)
      return res.status(403).json({ message: "Không có quyền" });

    await prisma.friendship.delete({ where: { id: friendshipId } });

    return res.json({ message: "Đã xử lý lời mời." });
  } catch (err) {
    console.error("Decline friend error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});

// ─────────────────────────────────────────
//  XÓA BẠN BÈ — POST /friends/remove
// ─────────────────────────────────────────
router.post("/remove", authMiddleware, async (req, res) => {
  const myId = req.user.userId;
  const { friendId } = req.body;

  if (!friendId)
    return res.status(400).json({ message: "Thiếu friendId" });

  try {
    const friendship = await prisma.friendship.findFirst({
      where: {
        status: "accepted",
        OR: [
          { senderId: myId,     receiverId: friendId },
          { senderId: friendId, receiverId: myId     },
        ],
      },
    });

    if (!friendship)
      return res.status(404).json({ message: "Không tìm thấy quan hệ bạn bè" });

    await prisma.friendship.delete({ where: { id: friendship.id } });

    return res.json({ message: "Đã xóa bạn bè." });
  } catch (err) {
    console.error("Remove friend error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});

// ─────────────────────────────────────────
//  DANH SÁCH BẠN BÈ — GET /friends/list
// ─────────────────────────────────────────
router.get("/list", authMiddleware, async (req, res) => {
  const myId = req.user.userId;

  try {
    const friendships = await prisma.friendship.findMany({
      where: {
        status: "accepted",
        OR: [{ senderId: myId }, { receiverId: myId }],
      },
      include: {
        sender:   { select: { id: true, username: true, stats: { select: { elo: true } } } },
        receiver: { select: { id: true, username: true, stats: { select: { elo: true } } } },
      },
      orderBy: { updatedAt: "desc" },
    });

    const friends = friendships.map(f => {
      const friend = f.senderId === myId ? f.receiver : f.sender;
      return {
        friendshipId: f.id,
        id: friend.id,
        username: friend.username,
        elo: friend.stats?.elo ?? 1000,
      };
    });

    return res.json(friends);
  } catch (err) {
    console.error("Friend list error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});

// ─────────────────────────────────────────
//  DANH SÁCH LỜI MỜI ĐANG CHỜ — GET /friends/pending
// ─────────────────────────────────────────
router.get("/pending", authMiddleware, async (req, res) => {
  const myId = req.user.userId;

  try {
    const pending = await prisma.friendship.findMany({
      where: { receiverId: myId, status: "pending" },
      include: {
        sender: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(pending.map(f => ({
      friendshipId: f.id,
      from: { id: f.sender.id, username: f.sender.username },
      createdAt: f.createdAt,
    })));
  } catch (err) {
    console.error("Pending friends error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});

// ─────────────────────────────────────────
//  MỜI BẠN BÈ VÀO PHÒNG — POST /friends/invite-room
//  Chỉ gửi socket event, không lưu DB
// ─────────────────────────────────────────
router.post("/invite-room", authMiddleware, async (req, res) => {
  const myId = req.user.userId;
  const { friendId, roomId } = req.body;

  if (!friendId || !roomId)
    return res.status(400).json({ message: "Thiếu friendId hoặc roomId" });

  try {
    // Kiểm tra đã là bạn bè chưa
    const friendship = await prisma.friendship.findFirst({
      where: {
        status: "accepted",
        OR: [
          { senderId: myId,     receiverId: friendId },
          { senderId: friendId, receiverId: myId     },
        ],
      },
    });

    if (!friendship)
      return res.status(403).json({ message: "Chỉ có thể mời bạn bè" });

    const sender = await prisma.user.findUnique({
      where: { id: myId },
      select: { id: true, username: true },
    });

    const io = getIO(req);
    if (io) {
      io.to("user_" + friendId).emit("roomInvite", {
        roomId,
        from: { id: sender.id, username: sender.username },
      });
    }

    return res.json({ message: "Đã gửi lời mời vào phòng!" });
  } catch (err) {
    console.error("Invite room error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});

module.exports = router;