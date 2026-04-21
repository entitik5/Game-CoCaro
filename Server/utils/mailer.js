const nodemailer = require("nodemailer");

// Tạo transporter — kết nối đến Gmail SMTP
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: false, // false = dùng STARTTLS (port 587)
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// Hàm gửi mail xác nhận đăng ký
async function sendVerifyMail(toEmail, username, code) {
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: toEmail,
    subject: "Xác nhận tài khoản CoCaro",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
        <h2 style="color: #4f46e5;">Xin chào ${username}!</h2>
        <p>Cảm ơn bạn đã đăng ký tài khoản <strong>CoCaro</strong>.</p>
        <p>Mã xác nhận của bạn là:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px;
                    color: #4f46e5; text-align: center; padding: 16px;
                    background: #f0f0ff; border-radius: 8px; margin: 16px 0;">
          ${code}
        </div>
        <p>Mã có hiệu lực trong <strong>15 phút</strong>.</p>
        <p style="color: #888; font-size: 13px;">
          Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email này.
        </p>
      </div>
    `,
  });
}

// Hàm gửi mail reset mật khẩu
async function sendResetMail(toEmail, username, code) {
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: toEmail,
    subject: "Đặt lại mật khẩu CoCaro",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
        <h2 style="color: #4f46e5;">Xin chào ${username}!</h2>
        <p>Bạn vừa yêu cầu đặt lại mật khẩu <strong>CoCaro</strong>.</p>
        <p>Mã xác nhận của bạn là:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px;
                    color: #4f46e5; text-align: center; padding: 16px;
                    background: #f0f0ff; border-radius: 8px; margin: 16px 0;">
          ${code}
        </div>
        <p>Mã có hiệu lực trong <strong>15 phút</strong>.</p>
        <p style="color: #888; font-size: 13px;">
          Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.
        </p>
      </div>
    `,
  });
}

module.exports = { sendVerifyMail, sendResetMail };