const jwt = require("jsonwebtoken");

function authMiddleware(req, res, next) {
  // Lấy token từ header Authorization: Bearer <token>
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Không có token, vui lòng đăng nhập" });
  }

  const token = authHeader.split(" ")[1]; // Tách lấy phần token

  try {
    // Verify token — nếu sai hoặc hết hạn sẽ throw lỗi
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Gắn thông tin user vào request để dùng ở route sau
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token không hợp lệ hoặc đã hết hạn" });
  }
}

module.exports = authMiddleware;