const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const prisma = require("../prisma/client");
const { sendVerifyMail, sendResetMail } = require("../utils/mailer");
const authMiddleware = require("../middleware/authMiddleware");

// Hàm sinh mã 6 số ngẫu nhiên
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─────────────────────────────────────────
//  ĐĂNG KÝ — POST /auth/register
// ─────────────────────────────────────────
router.post(
  "/register",
  [
    body("username").trim().isLength({ min: 3, max: 50 }).withMessage("Tên người dùng phải từ 3-50 ký tự"),
    body("email").isEmail().withMessage("Email không hợp lệ"),
    body("password").isLength({ min: 6 }).withMessage("Mật khẩu phải ít nhất 6 ký tự"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { username, email, password } = req.body;

    try {
      const existing = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
      });

      if (existing) {
        return res.status(400).json({
          message: existing.email === email
            ? "Email đã được sử dụng"
            : "Tên người dùng đã được sử dụng",
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const verifyToken = generateCode();
      const verifyExpires = new Date(Date.now() + 15 * 60 * 1000);

      const user = await prisma.user.create({
        data: {
          username,
          email,
          passwordHash,
          isVerified: false,
          verifyToken,
          verifyExpires,
          stats: { create: {} },
        },
      });

      await sendVerifyMail(email, username, verifyToken);

      return res.status(201).json({
        message: "Đăng ký thành công! Vui lòng kiểm tra email để lấy mã xác nhận.",
      });

    } catch (err) {
      console.error("Register error:", err);
      return res.status(500).json({ message: "Lỗi server" });
    }
  }
);

// ─────────────────────────────────────────
//  XÁC NHẬN EMAIL — POST /auth/verify
// ─────────────────────────────────────────
router.post("/verify", async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ message: "Vui lòng nhập email và mã xác nhận" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) return res.status(400).json({ message: "Email không tồn tại" });
    if (user.isVerified) return res.status(400).json({ message: "Tài khoản đã được xác nhận rồi" });

    if (user.verifyToken !== code) {
      return res.status(400).json({ message: "Mã xác nhận không đúng" });
    }

    if (!user.verifyExpires || user.verifyExpires < new Date()) {
      return res.status(400).json({ message: "Mã xác nhận đã hết hạn, vui lòng đăng ký lại" });
    }

    await prisma.user.update({
      where: { email },
      data: {
        isVerified: true,
        verifyToken: null,
        verifyExpires: null,
      },
    });

    return res.json({ message: "Xác nhận email thành công! Bạn có thể đăng nhập." });

  } catch (err) {
    console.error("Verify error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});

// ─────────────────────────────────────────
//  GỬI LẠI MÃ XÁC NHẬN — POST /auth/resend-verify
// ─────────────────────────────────────────
router.post("/resend-verify", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Thiếu email" });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.isVerified) return res.json({ message: "ok" });
    const verifyToken = generateCode();
    const verifyExpires = new Date(Date.now() + 15 * 60 * 1000);
    await prisma.user.update({
      where: { email },
      data: { verifyToken, verifyExpires },
    });
    await sendVerifyMail(email, user.username, verifyToken);
    return res.json({ message: "ok" });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi server" });
  }
});

// ─────────────────────────────────────────
//  GỬI LẠI MÃ ĐẶT LẠI MẬT KHẨU — POST /auth/resend-forgot
// ─────────────────────────────────────────
router.post("/resend-forgot", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Thiếu email" });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json({ message: "ok" });
    const resetToken = generateCode();
    const resetExpires = new Date(Date.now() + 15 * 60 * 1000);
    await prisma.user.update({
      where: { email },
      data: { resetToken, resetExpires },
    });
    await sendResetMail(email, user.username, resetToken);
    return res.json({ message: "ok" });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi server" });
  }
});

// ─────────────────────────────────────────
//  ĐĂNG NHẬP — POST /auth/login
// ─────────────────────────────────────────
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Email không hợp lệ"),
    body("password").notEmpty().withMessage("Vui lòng nhập mật khẩu"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;

    try {
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) return res.status(400).json({ message: "Email hoặc mật khẩu không đúng" });

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) return res.status(400).json({ message: "Email hoặc mật khẩu không đúng" });

      if (!user.isVerified) {
        return res.status(403).json({ message: "Vui lòng xác nhận email trước khi đăng nhập" });
      }

      const token = jwt.sign(
        { userId: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );

      return res.json({
        message: "Đăng nhập thành công",
        token,
        user: { id: user.id, username: user.username, email: user.email },
      });

    } catch (err) {
      console.error("Login error:", err);
      return res.status(500).json({ message: "Lỗi server" });
    }
  }
);

// ─────────────────────────────────────────
//  QUÊN MẬT KHẨU — POST /auth/forgot-password
// ─────────────────────────────────────────
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Vui lòng nhập email" });

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) return res.json({ message: "Nếu email tồn tại, mã xác nhận sẽ được gửi." });

    const code = generateCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({
      where: { email },
      data: { resetToken: code, resetExpires: expires },
    });

    await sendResetMail(email, user.username, code);

    return res.json({ message: "Nếu email tồn tại, mã xác nhận sẽ được gửi." });

  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});

// ─────────────────────────────────────────
//  ĐẶT LẠI MẬT KHẨU — POST /auth/reset-password
// ─────────────────────────────────────────
router.post("/reset-password", async (req, res) => {
  const { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword) {
    return res.status(400).json({ message: "Vui lòng nhập đầy đủ thông tin" });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: "Mật khẩu mới phải ít nhất 6 ký tự" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.resetToken !== code) {
      return res.status(400).json({ message: "Mã xác nhận không đúng" });
    }

    if (user.resetExpires < new Date()) {
      return res.status(400).json({ message: "Mã xác nhận đã hết hạn" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { email },
      data: { passwordHash, resetToken: null, resetExpires: null },
    });

    return res.json({ message: "Đặt lại mật khẩu thành công! Bạn có thể đăng nhập." });

  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});

// ─────────────────────────────────────────
//  LẤY STATS CỦA USER — GET /auth/me/stats
//  Yêu cầu đăng nhập (JWT token hợp lệ)
// ─────────────────────────────────────────
router.get("/me/stats", authMiddleware, async (req, res) => {
  try {
    const stats = await prisma.userStats.findUnique({
      where: { userId: req.user.userId },
    });
    if (!stats) return res.status(404).json({ message: "Không tìm thấy stats" });
    return res.json(stats);
  } catch (err) {
    console.error("Get stats error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});

module.exports = router;