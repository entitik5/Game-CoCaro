// =============================================================================
//  AUTH.JS — Xử lý đăng nhập, đăng ký, xác nhận email, reset mật khẩu
// =============================================================================

const API = window.location.origin;

let _pendingEmail = "";
let _verifyCodeCooldown = 0;
let _forgotCodeCooldown = 0;

// ─────────────────────────────────────────
//  COOLDOWN HANDLER
// ─────────────────────────────────────────

function startResendCooldown(btnId, cooldownTime = 60) {
  const btn = document.getElementById(btnId);
  let remaining = cooldownTime;
  
  btn.disabled = true;
  btn.textContent = `Gửi lại mã (${remaining}s)`;
  
  const interval = setInterval(() => {
    remaining--;
    btn.textContent = `Gửi lại mã (${remaining}s)`;
    
    if (remaining <= 0) {
      clearInterval(interval);
      btn.disabled = false;
      btn.textContent = "Gửi lại mã";
      if (btnId === "resendCode") _verifyCodeCooldown = 0;
      else if (btnId === "resendForgotCode") _forgotCodeCooldown = 0;
    }
  }, 1000);
}

// ─────────────────────────────────────────
//  PASSWORD VISIBILITY TOGGLE
// ─────────────────────────────────────────

function togglePasswordVisibility(fieldId) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.type = field.type === "password" ? "text" : "password";
}

// ─────────────────────────────────────────
//  TOKEN HELPERS
// ─────────────────────────────────────────

function saveToken(token, user) {
  localStorage.setItem("caro_token", token);
  localStorage.setItem("caro_user", JSON.stringify(user));
}

function getToken() {
  return localStorage.getItem("caro_token");
}

function getUser() {
  try { return JSON.parse(localStorage.getItem("caro_user")); }
  catch { return null; }
}

function clearToken() {
  localStorage.removeItem("caro_token");
  localStorage.removeItem("caro_user");
}

window.getAuthToken = getToken;
window.getAuthUser  = getUser;

// ─────────────────────────────────────────
//  TOAST (dùng chung với ui.js)
// ─────────────────────────────────────────

function authToast(msg, ms = 2800) {
  if (typeof toast === "function") { toast(msg, ms); return; }
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg; t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), ms);
}

// ─────────────────────────────────────────
//  CONFIRM MODAL (thay thế confirm() của trình duyệt)
// ─────────────────────────────────────────

// Tạo modal xác nhận dùng chung toàn app
function showConfirm(message, onConfirm, onCancel) {
  document.getElementById("confirmModal")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "confirmModal";
  overlay.className = "popup-bg";
  overlay.style.cssText = "display:flex;align-items:center;justify-content:center;z-index:9999;";
  overlay.innerHTML = `
    <div class="popup-card" style="max-width:360px;padding:28px 24px;text-align:center;">
      <p style="font-size:15px;margin:0 0 20px;line-height:1.6;color:var(--color-text-primary)">${message}</p>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button id="confirmYes" class="btn-gold" style="min-width:90px">Xác nhận</button>
        <button id="confirmNo" class="btn-ghost" style="min-width:90px">Hủy</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  document.getElementById("confirmYes").onclick = () => { close(); onConfirm?.(); };
  document.getElementById("confirmNo").onclick  = () => { close(); onCancel?.(); };
  overlay.onclick = (e) => { if (e.target === overlay) { close(); onCancel?.(); } };
}

window.showConfirm = showConfirm;

// ─────────────────────────────────────────
//  STATS TỪ DB
// ─────────────────────────────────────────

window._dbStats = { wins: 0, losses: 0, draws: 0 };

async function loadStatsFromDB() {
  const token = getToken();
  if (!token) {
    window._dbStats = { wins: 0, losses: 0, draws: 0 };
    return;
  }
  try {
    const res = await fetch(API + "/auth/me/stats", {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.ok) {
      const data = await res.json();
      window._dbStats = { wins: data.wins, losses: data.losses, draws: data.draws };
    }
  } catch (err) {
    console.error("Load stats error:", err);
  }
  window.dispatchEvent(new Event("statsLoaded"));
}

window.getDBStats = () => window._dbStats;
window.loadStatsFromDB = loadStatsFromDB;

// ─────────────────────────────────────────
//  HIỂN THỊ / ẨN FORM
// ─────────────────────────────────────────

const modal = document.getElementById("authModal");
const formIds = ["formLogin", "formRegister", "formVerify", "formForgot", "formReset"];

function showModal(formId) {
  modal.classList.remove("hidden");
  formIds.forEach(id => {
    document.getElementById(id).classList.toggle("hidden", id !== formId);
  });
  clearErrors();
}

function hideModal() {
  modal.classList.add("hidden");
  clearErrors();
}

function clearErrors() {
  document.querySelectorAll(".auth-error").forEach(el => {
    el.classList.add("hidden");
    el.textContent = "";
  });
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove("hidden");
}

// ─────────────────────────────────────────
//  CẬP NHẬT HEADER
// ─────────────────────────────────────────

function updateAuthHeader() {
  const user       = getUser();
  const btnOpen    = document.getElementById("btnOpenAuth");
  const userInfo   = document.getElementById("authUserInfo");
  const usernameEl = document.getElementById("authUsername");

  if (user && getToken()) {
    btnOpen.classList.add("hidden");
    userInfo.classList.remove("hidden");
    usernameEl.textContent = "👤 " + user.username;
  } else {
    btnOpen.classList.remove("hidden");
    userInfo.classList.add("hidden");
  }
}

// ─────────────────────────────────────────
//  API HELPER
// ─────────────────────────────────────────

async function apiPost(path, body) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

// ─────────────────────────────────────────
//  ĐĂNG KÝ
// ─────────────────────────────────────────

document.getElementById("btnRegister").onclick = async () => {
  const username = document.getElementById("regUsername").value.trim();
  const email    = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;

  if (!username || !email || !password) return showError("registerError", "Vui lòng nhập đầy đủ thông tin");
  if (username.length < 3) return showError("registerError", "Tên người dùng phải ít nhất 3 ký tự");
  if (password.length < 6) return showError("registerError", "Mật khẩu phải ít nhất 6 ký tự");

  const btn = document.getElementById("btnRegister");
  btn.disabled = true; btn.textContent = "Đang xử lý...";

  const { ok, data } = await apiPost("/auth/register", { username, email, password });

  btn.disabled = false; btn.textContent = "Đăng ký";

  if (!ok) {
    const msg = data.errors?.[0]?.msg || data.message || "Đăng ký thất bại";
    return showError("registerError", msg);
  }

  _pendingEmail = email;
  showModal("formVerify");
};

// ─────────────────────────────────────────
//  XÁC NHẬN EMAIL
// ─────────────────────────────────────────

document.getElementById("btnVerify").onclick = async () => {
  const code = document.getElementById("verifyCode").value.trim();
  if (code.length !== 6) return showError("verifyError", "Mã xác nhận phải có 6 số");

  const btn = document.getElementById("btnVerify");
  btn.disabled = true; btn.textContent = "Đang xác nhận...";

  const { ok, data } = await apiPost("/auth/verify", { email: _pendingEmail, code });

  btn.disabled = false; btn.textContent = "Xác nhận";

  if (!ok) return showError("verifyError", data.message || "Mã không đúng hoặc đã hết hạn");

  hideModal();
  authToast("✅ Xác nhận email thành công! Vui lòng đăng nhập.", 3500);
  setTimeout(() => showModal("formLogin"), 500);
};

document.getElementById("resendCode").onclick = async () => {
  if (!_pendingEmail || _verifyCodeCooldown > 0) return;
  
  _verifyCodeCooldown = 60;
  await apiPost("/auth/resend-verify", { email: _pendingEmail });
  authToast("📧 Đã gửi lại mã xác nhận, vui lòng kiểm tra email.");
  startResendCooldown("resendCode", 60);
};

document.getElementById("resendForgotCode").onclick = async () => {
  if (!_pendingEmail || _forgotCodeCooldown > 0) return;
  
  _forgotCodeCooldown = 60;
  await apiPost("/auth/resend-forgot", { email: _pendingEmail });
  authToast("📧 Đã gửi lại mã xác nhận, vui lòng kiểm tra email.");
  startResendCooldown("resendForgotCode", 60);
};

// ─────────────────────────────────────────
//  ĐĂNG NHẬP
// ─────────────────────────────────────────

document.getElementById("btnLogin").onclick = async () => {
  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!email || !password) return showError("loginError", "Vui lòng nhập email và mật khẩu");

  const btn = document.getElementById("btnLogin");
  btn.disabled = true; btn.textContent = "Đang đăng nhập...";

  const { ok, data } = await apiPost("/auth/login", { email, password });

  btn.disabled = false; btn.textContent = "Đăng nhập";

  if (!ok) {
    if (data.message?.includes("xác nhận email")) {
      _pendingEmail = email;
      showModal("formVerify");
      return;
    }
    return showError("loginError", data.message || "Đăng nhập thất bại");
  }

  saveToken(data.token, data.user);
  await loadStatsFromDB();
  window.dispatchEvent(new Event("authChanged"));
  hideModal();
  updateAuthHeader();
  authToast("👋 Xin chào, " + data.user.username + "!");
};

// ─────────────────────────────────────────
//  QUÊN MẬT KHẨU
// ─────────────────────────────────────────

document.getElementById("btnForgot").onclick = async () => {
  const email = document.getElementById("forgotEmail").value.trim();
  if (!email) return showError("forgotError", "Vui lòng nhập email");

  const btn = document.getElementById("btnForgot");
  btn.disabled = true; btn.textContent = "Đang gửi...";

  const { ok, data } = await apiPost("/auth/forgot-password", { email });

  btn.disabled = false; btn.textContent = "Gửi mã";

  if (!ok) return showError("forgotError", data.message || "Có lỗi xảy ra");

  _pendingEmail = email;
  showModal("formReset");
  authToast("📧 Mã xác nhận đã được gửi đến email của bạn.");
};

// ─────────────────────────────────────────
//  ĐẶT LẠI MẬT KHẨU
// ─────────────────────────────────────────

document.getElementById("btnReset").onclick = async () => {
  const code        = document.getElementById("resetCode").value.trim();
  const newPassword = document.getElementById("resetPassword").value;

  if (code.length !== 6) return showError("resetError", "Mã xác nhận phải có 6 số");
  if (newPassword.length < 6) return showError("resetError", "Mật khẩu mới phải ít nhất 6 ký tự");

  const btn = document.getElementById("btnReset");
  btn.disabled = true; btn.textContent = "Đang xử lý...";

  const { ok, data } = await apiPost("/auth/reset-password", {
    email: _pendingEmail, code, newPassword,
  });

  btn.disabled = false; btn.textContent = "Đặt lại mật khẩu";

  if (!ok) return showError("resetError", data.message || "Có lỗi xảy ra");

  hideModal();
  authToast("✅ Đặt lại mật khẩu thành công! Vui lòng đăng nhập.", 3500);
  setTimeout(() => showModal("formLogin"), 500);
};

// ─────────────────────────────────────────
//  ĐĂNG XUẤT
// ─────────────────────────────────────────

document.getElementById("btnLogout").onclick = () => {
  clearToken();
  window._dbStats = { wins: 0, losses: 0, draws: 0 };
  window.dispatchEvent(new Event("authChanged"));
  window.dispatchEvent(new Event("statsLoaded"));
  updateAuthHeader();
  authToast("👋 Đã đăng xuất.");
};

// ─────────────────────────────────────────
//  ĐIỀU HƯỚNG GIỮA CÁC FORM
// ─────────────────────────────────────────

document.getElementById("btnOpenAuth").onclick   = () => showModal("formLogin");
document.getElementById("toRegister").onclick    = () => showModal("formRegister");
document.getElementById("toLogin").onclick       = () => showModal("formLogin");
document.getElementById("toForgot").onclick      = () => showModal("formForgot");
document.getElementById("backToLogin").onclick   = () => showModal("formLogin");

const backToLoginFromReset = document.getElementById("backToLoginFromReset");
if (backToLoginFromReset) backToLoginFromReset.onclick = () => showModal("formLogin");

document.getElementById("closeAuth").onclick        = hideModal;
document.getElementById("closeAuthReg").onclick     = hideModal;
document.getElementById("closeAuthForgot").onclick  = hideModal;

modal.addEventListener("click", (e) => { if (e.target === modal) hideModal(); });

// ─────────────────────────────────────────
//  KHỞI TẠO
// ─────────────────────────────────────────

loadStatsFromDB();
updateAuthHeader();