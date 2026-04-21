const socket = io({
  auth: {
    token: window.getAuthToken ? window.getAuthToken() : null,
  },
});

/* ── STATE ── */
let MY_ID = localStorage.getItem("caro_pid");
if (!MY_ID) { MY_ID = "p_" + Math.random().toString(36).slice(2, 9); localStorage.setItem("caro_pid", MY_ID); }

const ICONS = [
  "✕","○","△","□","◆","★","✦","⊕",
  "⊗","⊙","◎","◉","◈","⊞","⊟","⊠",
  "♟","♔","♕","♖","♗","♘","♙",
  "✚","✜","✤","✿","❋","❊","❉","❈"
];

const COLORS = [
  { hex: "#3b82f6", name: "Xanh" },
  { hex: "#ef4444", name: "Đỏ" },
  { hex: "#a855f7", name: "Tím" },
  { hex: "#eab308", name: "Vàng" },
  { hex: "#111111", name: "Đen" },
  { hex: "#ec4899", name: "Hồng" },
  { hex: "#ffffff", name: "Trắng" },
  { hex: "#22c55e", name: "Xanh lá" },
];
function iconCls(ic) {
  if (["✕","⊗","⊠","⊟","✚","✜","✤"].includes(ic)) return "ix";
  if (["○","⊕","⊙","◎","◉","◈","⊞"].includes(ic)) return "io";
  return "";
}

let myIcon = localStorage.getItem("caro_icon") || ICONS[0];
let myColor = localStorage.getItem("caro_color") || COLORS[0].hex;
let myName = localStorage.getItem("caro_name") || "";
let lockedIcons = new Set();

let S = { roomId:"", sym:"", icon:"", turn:"", started:false, over:false,
          size:0, winCount:5, dirs:[], maxP:0, bot:false, botDiff:"medium", timePerTurn:30 };

/* ── TOAST ── */
let _tt;
function toast(msg, ms=2400) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(_tt); _tt = setTimeout(() => t.classList.add("hidden"), ms);
}

/* ── CONFIRM ── */
function uiConfirm(message, onConfirm, onCancel) {
  if (window.showConfirm) { window.showConfirm(message, onConfirm, onCancel); return; }
  if (confirm(message)) onConfirm?.(); else onCancel?.();
}

/* ── COUNTDOWN OVERLAY ── */
const _cdStyle = document.createElement("style");
_cdStyle.textContent = `
  @keyframes cdPop{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}
  @keyframes cdFadeIn{from{opacity:0}to{opacity:1}}
  #countdownOverlay{animation:cdFadeIn .2s ease}
`;
document.head.appendChild(_cdStyle);

function showCountdown(n) {
  let overlay = document.getElementById("countdownOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "countdownOverlay";
    overlay.style.cssText = [
      "position:fixed;inset:0;z-index:500",
      "background:rgba(0,0,0,.78)",
      "backdrop-filter:blur(5px)",
      "display:flex;flex-direction:column",
      "align-items:center;justify-content:center;gap:14px",
    ].join(";");
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="font-size:12px;color:var(--sub);letter-spacing:2.5px;text-transform:uppercase;font-family:var(--serif)">
      Ván đấu bắt đầu sau
    </div>
    <div style="
      font-size:110px;font-weight:900;color:var(--gold);
      font-family:'Courier New',monospace;line-height:1;
      animation:cdPop .35s cubic-bezier(.34,1.5,.64,1);
      text-shadow:0 0 40px rgba(200,153,42,.5)
    ">${n}</div>
    <div style="font-size:13px;color:var(--dim);font-style:italic;font-family:var(--serif)">
      Chuẩn bị nào! 🎯
    </div>
  `;
}

function hideCountdown() {
  const overlay = document.getElementById("countdownOverlay");
  if (overlay) overlay.remove();
}

/* ── RECONNECT OVERLAY ── */
let _reconnectTimer = null;
let _reconnectSeconds = 0;

function showReconnectOverlay() {
  if (!S.roomId || S.roomId === "BOT") return;

  let overlay = document.getElementById("reconnectOverlay");
  if (overlay) return;

  overlay = document.createElement("div");
  overlay.id = "reconnectOverlay";
  overlay.style.cssText = [
    "position:fixed;inset:0;z-index:600",
    "background:rgba(0,0,0,.82)",
    "backdrop-filter:blur(4px)",
    "display:flex;flex-direction:column",
    "align-items:center;justify-content:center;gap:16px",
  ].join(";");
  overlay.innerHTML = `
    <div style="
      display:flex;flex-direction:column;align-items:center;gap:14px;
      background:var(--bg2);border:1px solid var(--border2);
      border-radius:12px;padding:36px 48px;
      box-shadow:0 20px 60px rgba(0,0,0,.7);
      position:relative;overflow:hidden;
    ">
      <div style="
        position:absolute;top:0;left:0;right:0;height:2px;
        background:linear-gradient(90deg,transparent,var(--gold),transparent);
      "></div>

      <!-- Spinner -->
      <div id="rcSpinner" style="
        width:48px;height:48px;border-radius:50%;
        border:3px solid var(--border2);
        border-top-color:var(--gold);
        animation:rcSpin .8s linear infinite;
      "></div>

      <div style="text-align:center">
        <div style="
          font-size:16px;font-weight:700;color:var(--text);
          font-family:var(--serif);margin-bottom:6px;
        ">Mất kết nối</div>
        <div style="
          font-size:13px;color:var(--sub);font-style:italic;
          font-family:var(--serif);
        ">Đang kết nối lại...</div>
      </div>

      <!-- Đếm giây -->
      <div style="
        font-family:'Courier New',monospace;font-size:12px;
        color:var(--dim);background:var(--bg3);
        border:1px solid var(--border);border-radius:20px;
        padding:4px 14px;
      ">
        Đã chờ <span id="rcSeconds">0</span>s
      </div>

      <!-- Nút thoát phòng nếu chờ quá lâu -->
      <button id="rcLeaveBtn" onclick="leaveRoom()" style="
        display:none;
        background:transparent;border:1px solid var(--border2);
        color:var(--sub);padding:7px 18px;border-radius:var(--r);
        cursor:pointer;font-size:12px;font-family:var(--serif);
        transition:all .13s;margin-top:4px;
      ">Thoát phòng</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Inject keyframe spinner nếu chưa có
  if (!document.getElementById("rcStyle")) {
    const s = document.createElement("style");
    s.id = "rcStyle";
    s.textContent = `@keyframes rcSpin{to{transform:rotate(360deg)}}`;
    document.head.appendChild(s);
  }

  // Đếm giây
  _reconnectSeconds = 0;
  _reconnectTimer = setInterval(() => {
    _reconnectSeconds++;
    const el = document.getElementById("rcSeconds");
    if (el) el.textContent = _reconnectSeconds;
    if (_reconnectSeconds >= 8) {
      const btn = document.getElementById("rcLeaveBtn");
      if (btn) btn.style.display = "block";
    }
  }, 1000);
}

function hideReconnectOverlay() {
  clearInterval(_reconnectTimer);
  _reconnectSeconds = 0;
  const overlay = document.getElementById("reconnectOverlay");
  if (overlay) {
    overlay.style.transition = "opacity .3s";
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 300);
  }
}

socket.on("countdown", ({ count }) => { showCountdown(count); });

/* ── SOCKET DISCONNECT / RECONNECT ── */
socket.on("disconnect", (reason) => {
  if (!S.started || S.over || S.bot) return;
  showReconnectOverlay();
});

socket.on("connect", () => {
  // Khi reconnect thành công
  hideReconnectOverlay();

  if (S.roomId && S.roomId !== "BOT" && MY_ID) {
    socket.emit("reconnectToRoom", { roomId: S.roomId, playerId: MY_ID });
  }
});

/* ── SCREENS ── */
function go(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  const el = document.getElementById(id); el.classList.remove("hidden");
  void el.offsetWidth;
}

/* ── PROFILE CARD ── */
function updateProfileCard() {
  const authUser = window.getAuthUser ? window.getAuthUser() : null;
  const loggedIn = document.getElementById("pcLoggedIn");
  const guest    = document.getElementById("pcGuest");
  const profileId = document.getElementById("profileId");

  if (authUser) {
    loggedIn.classList.remove("hidden");
    guest.classList.add("hidden");
    document.getElementById("pcUsername").textContent = authUser.username;
    profileId.textContent = "ID: #" + authUser.id;
    myName = authUser.username;
  } else {
    loggedIn.classList.add("hidden");
    guest.classList.remove("hidden");
    profileId.textContent = "ID: " + MY_ID.slice(0, 10);
  }
}

/* ── PILLS ── */
function initPills(gid, hid, cb) {
  const g = document.getElementById(gid); if (!g) return;
  g.querySelectorAll(".pill").forEach(p => p.onclick = () => {
    g.querySelectorAll(".pill").forEach(x => x.classList.remove("on"));
    p.classList.add("on"); document.getElementById(hid).value = p.dataset.val; cb?.();
  });
}
function updateSummary() {
  const bs = document.getElementById("boardSize")?.value || 10;
  const wc = document.getElementById("winCountSelect")?.value || 5;
  const mp = document.getElementById("maxPlayers").value;
  const tp = document.getElementById("timePerTurn")?.value || 30;
  const s = (!mp || mp === "0") ? "Tidak terbatas" : mp + " người";
  const el = document.getElementById("createSummary"); if (el) el.textContent = `Bàn ${bs}×${bs} · Thắng ${wc} ô · ${s} · ⏱${tp}s`;
}

/* ── COLOR PICKERS ── */
function buildColorPicker(cid, onPick) {
  const c = document.getElementById(cid); if (!c) return;
  c.innerHTML = "";
  COLORS.forEach(col => {
    const el = document.createElement("div");
    el.className = "color-opt" + (col.hex === myColor ? " selected" : "");
    el.style.background = col.hex; el.title = col.name;
    el.onclick = () => {
      myColor = col.hex; localStorage.setItem("caro_color", col.hex);
      c.querySelectorAll(".color-opt").forEach(e => e.classList.remove("selected"));
      el.classList.add("selected"); onPick?.(col.hex);
    };
    c.appendChild(el);
  });
}

/* ── ICON PICKERS ── */
function buildPicker(cid, showTaken, onPick) {
  const c = document.getElementById(cid); if (!c) return;
  c.innerHTML = "";
  ICONS.forEach(ic => {
    const el = document.createElement("div");
    const cls = iconCls(ic), taken = showTaken && lockedIcons.has(ic);
    el.className = "icon-opt" + (cls ? " " + cls : "") + (ic === myIcon ? " selected" : "") + (taken ? " taken" : "");
    el.textContent = ic; el.title = taken ? "Đã có người dùng" : ic;
    el.onclick = () => {
      if (taken) return;
      myIcon = ic; localStorage.setItem("caro_icon", ic);
      c.querySelectorAll(".icon-opt").forEach(e => e.classList.remove("selected"));
      el.classList.add("selected"); onPick?.(ic);
    };
    c.appendChild(el);
  });
}
function buildBotPicker() {
  buildPicker("botIconPicker", false, ic => {
    const p = document.getElementById("botIconPreview"); if (p) { p.textContent = ic; p.className = iconCls(ic); p.style.color = myColor; }
  });
  const p = document.getElementById("botIconPreview"); if (p) { p.textContent = myIcon; p.className = iconCls(myIcon); p.style.color = myColor; }
  buildColorPicker("botColorPicker", col => {
    const p = document.getElementById("botIconPreview"); if (p) p.style.color = col;
  });
}
function buildLobbyPicker() {
  buildPicker("lobbyIconPicker", true, ic => socket.emit("changeIcon", { roomId: S.roomId, icon: ic }));
  buildColorPicker("lobbyColorPicker", col => socket.emit("changeColor", { roomId: S.roomId, color: col }));
}
function syncLocked(players) {
  lockedIcons = new Set(players.filter(p => p.playerId !== MY_ID && p.icon).map(p => p.icon));
  if (lockedIcons.has(myIcon)) {
    const f = ICONS.find(i => !lockedIcons.has(i));
    if (f) { myIcon = f; localStorage.setItem("caro_icon", f); socket.emit("changeIcon", { roomId: S.roomId, icon: f }); }
  }
  buildLobbyPicker();
}

/* ── LEAVE ROOM HELPER ── */
function leaveRoom(callback) {
  if (S.roomId && S.roomId !== "BOT" && S.started && !S.over) {
    socket.emit("leaveRoom", { roomId: S.roomId });
  }
  // Đợi 1 tick để socket gửi xong rồi mới reload/callback
  setTimeout(() => { callback ? callback() : location.reload(); }, 80);
}
let _createMode = "quick";

function selectMode(mode) {
  _createMode = mode;
  document.getElementById("modeQuick").classList.toggle("active", mode === "quick");
  document.getElementById("modeCustom").classList.toggle("active", mode === "custom");
  const panel = document.getElementById("createCustomPanel");
  if (mode === "custom") panel.classList.remove("hidden");
  else panel.classList.add("hidden");
}

/* ── INIT ── */
window.addEventListener("DOMContentLoaded", () => {
  updateProfileCard();

  const ni = document.getElementById("playerName");
  if (ni) {
    ni.value = myName;
    ni.oninput = () => { myName = ni.value.trim(); localStorage.setItem("caro_name", myName); };
  }

  initPills("pBoardSize", "boardSize", updateSummary);
  initPills("pWinCount", "winCountSelect", updateSummary);
  initPills("pMaxPlayers", "maxPlayers", updateSummary);
  initPills("pTimePerTurn", "timePerTurn", updateSummary);
  initPills("pBotSize", "botBoardSize");
  initPills("pBotWin", "botWinCount");
  initPills("pBotTime", "botTimePerTurn");

  const savedTheme = localStorage.getItem("caro_theme") || "dark";
  applyTheme(savedTheme);
  document.getElementById("btnTheme").onclick = () => {
    const isLight = document.body.classList.contains("light");
    applyTheme(isLight ? "dark" : "light");
  };
  function applyTheme(t) {
    document.body.classList.toggle("light", t === "light");
    document.getElementById("btnTheme").textContent = t === "light" ? "🌙" : "☀️";
    localStorage.setItem("caro_theme", t);
  }

  function numInput(inputId, hintId, hiddenId, min, max, pillsSelector, extraCb) {
    const inp = document.getElementById(inputId), hint = document.getElementById(hintId);
    if (!inp) return;
    inp.oninput = () => {
      const raw = inp.value;
      if (raw === "" || raw === null) { inp.classList.remove("input-error"); if (hint) { hint.textContent = ""; hint.className = "input-hint"; } return; }
      const v = parseInt(raw);
      if (isNaN(v)) { inp.classList.add("input-error"); if (hint) { hint.textContent = "⚠ Vui lòng nhập số hợp lệ"; hint.className = "input-hint err"; } return; }
      if (v < min) { inp.classList.add("input-error"); if (hint) { hint.textContent = `⚠ Tối thiểu là ${min}`; hint.className = "input-hint err"; } return; }
      if (v > max) { inp.classList.add("input-error"); if (hint) { hint.textContent = `⚠ Tối đa là ${max} — vui lòng nhập lại`; hint.className = "input-hint err"; } return; }
      inp.classList.remove("input-error"); if (hint) { hint.textContent = `✓ Hợp lệ`; hint.className = "input-hint ok"; }
      document.getElementById(hiddenId).value = v;
      document.querySelectorAll(pillsSelector + " .pill").forEach(p => p.classList.remove("on"));
      extraCb?.();
    };
    inp.addEventListener("keydown", (e) => {
      if (["Backspace","Delete","Tab","ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) return;
      const hypothetical = parseInt(inp.value + e.key);
      if (!isNaN(hypothetical) && hypothetical > max) {
        e.preventDefault(); inp.classList.add("input-error");
        if (hint) { hint.textContent = `⚠ Tối đa là ${max}`; hint.className = "input-hint err"; }
        setTimeout(() => { inp.classList.remove("input-error"); if (hint && hint.textContent.startsWith("⚠ Tối đa")) { hint.textContent = ""; hint.className = "input-hint"; } }, 2000);
      }
    });
  }

  numInput("boardSizeInput",  "hintBoardSize",   "boardSize",      3, 30, "#pBoardSize",   updateSummary);
  numInput("winCountInput",   "hintWinCount",    "winCountSelect", 3, 10, "#pWinCount",    updateSummary);
  numInput("maxPlayersInput", "hintMaxPlayers",  "maxPlayers",     2, 99, "#pMaxPlayers",  updateSummary);
  numInput("timePerTurnInput","hintTimePerTurn", "timePerTurn",    5, 60, "#pTimePerTurn", updateSummary);
  numInput("botBoardSizeInput", "hintBotSize", "botBoardSize", 3, 30, "#pBotSize", null);
  numInput("botWinCountInput",  "hintBotWin",  "botWinCount",  3, 10, "#pBotWin",  null);
  numInput("botTimeInput",      "hintBotTime", "botTimePerTurn", 5, 60, "#pBotTime", null);

  updateSummary(); updateStats(); go("screen-menu");
  socket.emit("init", { playerId: MY_ID });
});

window.addEventListener("authChanged", () => {
  socket.auth.token = window.getAuthToken ? window.getAuthToken() : null;
  socket.disconnect().connect();
  updateProfileCard();
});

window.addEventListener("statsLoaded", () => updateStats());

/* ── MENU ── */
document.getElementById("btnCreateRoom").onclick = () => {
  selectMode("quick"); // reset về quick mỗi lần vào
  go("screen-create");
};
document.getElementById("btnBrowseRooms").onclick = () => { go("screen-rooms"); socket.emit("getRoomList"); };
document.getElementById("btnPlayBot").onclick = () => { buildBotPicker(); go("screen-bot"); };
document.getElementById("btnBackMenu1").onclick = () => go("screen-menu");
document.getElementById("btnBackMenu2").onclick = () => go("screen-menu");
document.getElementById("btnBackMenu3").onclick = () => go("screen-menu");

/* ── TẠO PHÒNG ── */
document.getElementById("btnConfirmCreate").onclick = () => {
  let boardSize, winCount, maxPlayers, timePerTurn, dirs;

  if (_createMode === "quick") {
    // Luật mặc định
    boardSize   = 10;
    winCount    = 5;
    maxPlayers  = 2;
    timePerTurn = 30;
    dirs        = ["horizontal", "vertical", "diagonal"];
  } else {
    // Lấy từ form tùy chỉnh
    boardSize   = +document.getElementById("boardSize").value;
    winCount    = +document.getElementById("winCountSelect").value;
    const mpVal = document.getElementById("maxPlayers").value;
    maxPlayers  = (!mpVal || mpVal === "0") ? 999 : +mpVal;
    timePerTurn = +document.getElementById("timePerTurn").value || 30;
    dirs        = [...document.querySelectorAll('input[name="dir"]:checked')].map(c => c.value);
    if (!dirs.length) { toast("⚠ Chọn ít nhất 1 hướng!"); return; }
  }

  socket.emit("createRoom", {
    boardSize, winCount, winDirections: dirs,
    maxPlayers, timePerTurn,
    playerId: MY_ID, icon: myIcon, color: myColor,
  });
};

socket.on("roomCreated", d => {
  Object.assign(S, { roomId: d.roomId, sym: d.symbol, icon: d.icon, color: d.color, size: d.boardSize, winCount: d.winCount, dirs: d.winDirections, maxP: d.maxPlayers, timePerTurn: d.timePerTurn || 30 });
  enterLobby(d);
});
document.getElementById("btnCopyRoom").onclick = () => {
  navigator.clipboard.writeText(S.roomId).then(() => {
    toast("✅ Đã sao chép mã phòng!");
    const b = document.getElementById("btnCopyRoom"); b.textContent = "✅ Đã sao chép!";
    setTimeout(() => b.textContent = "📋 Sao chép & mời", 2200);
  });
};

/* ── TÌM PHÒNG ── */
socket.on("roomList", renderRooms); socket.on("roomListUpdate", renderRooms);
function renderRooms(rooms) {
  const el = document.getElementById("roomList"); if (!el) return;
  if (!rooms?.length) { el.innerHTML = '<p style="color:var(--dim);text-align:center;padding:18px;font-size:12px;font-style:italic">Chưa có phòng nào</p>'; return; }
  el.innerHTML = rooms.map(r => {
    const mx = r.maxPlayers >= 999 ? "∞" : r.maxPlayers;
    return `<div class="room-item"><div class="ri-info"><b>${r.id}</b><span>${r.boardSize}×${r.boardSize} · ${r.winCount} ô · ⏱${r.timePerTurn || 30}s · ${r.currentPlayers}/${mx}</span></div><button class="room-join-btn" onclick="joinRoom('${r.id}')">Vào →</button></div>`;
  }).join("");
}
document.getElementById("btnRefreshRooms").onclick = () => { socket.emit("getRoomList"); toast("↺ Đã làm mới"); };
document.getElementById("btnJoinById").onclick = () => { const id = document.getElementById("joinRoomId").value.trim(); if (id) joinRoom(id); };
function joinRoom(id) { socket.emit("joinRoom", { roomId: id, playerId: MY_ID, icon: myIcon, color: myColor }); }
socket.on("joined", d => {
  Object.assign(S, { roomId: d.roomId, sym: d.symbol, icon: d.icon, color: d.color, size: d.boardSize, winCount: d.winCount, dirs: d.winDirections, maxP: d.maxPlayers, timePerTurn: d.timePerTurn || 30 });
  enterLobby(d);
});
socket.on("joinFailed", ({ reason }) => toast("❌ " + reason, 3200));

/* ── LOBBY ── */
function enterLobby(d) {
  go("screen-lobby");
  document.getElementById("lobbyRoomId").textContent = d.roomId;
  const mpStr = (!d.maxPlayers || d.maxPlayers >= 999) ? "Không giới hạn" : d.maxPlayers + " người";
  document.getElementById("roomSettingsSummary").innerHTML =
    `${d.boardSize}×${d.boardSize} · Thắng ${d.winCount} ô<br>${mpStr} · ⏱ ${d.timePerTurn || 30}s/lượt`;
  syncLocked(d.players); renderLobby(d.players, d.maxPlayers);
  const btn = document.getElementById("btnReady"); btn.disabled = false; btn.textContent = "✅ Sẵn sàng"; btn.dataset.ready = "0";
  const startBtn = document.getElementById("btnHostStart"); if (startBtn) startBtn.classList.add("hidden");
}
socket.on("kicked", ({ reason }) => {
  hideCountdown();
  toast("❌ " + (reason || "Bạn đã bị kick khỏi phòng!"), 3500);
  setTimeout(() => leaveRoom(), 3500);
});
socket.on("playerJoined", ({ players }) => { syncLocked(players); renderLobby(players, S.maxP); toast("👋 Có người vào phòng!"); });
socket.on("playerReadyUpdate", ({ players, allReady }) => {
  syncLocked(players); renderLobby(players, S.maxP);
  const me = players.find(p => p.playerId === MY_ID);
  const b = document.getElementById("btnReady");
  if (me?.ready) {
    b.disabled = false; b.textContent = "❌ Hủy sẵn sàng"; b.dataset.ready = "1"; b.classList.add("btn-cancel-ready");
  } else {
    b.disabled = false; b.textContent = "✅ Sẵn sàng"; b.dataset.ready = "0"; b.classList.remove("btn-cancel-ready");
  }
  const rdy = players.filter(p => p.ready).length;
  document.getElementById("lobbyHint").textContent =
    players.length < 2 ? "⏳ Mời bạn vào phòng..." :
    allReady ? "🚀 Tất cả sẵn sàng!" : `${rdy}/${players.length} sẵn sàng`;
  const startBtn = document.getElementById("btnHostStart");
  if (startBtn) {
    const isHost = players.length > 0 && players[0].playerId === MY_ID;
    startBtn.classList.toggle("hidden", !(isHost && allReady));
  }
});
socket.on("iconTaken", ({ icon }) => {
  const f = ICONS.find(i => !lockedIcons.has(i) && i !== icon);
  if (f) { myIcon = f; localStorage.setItem("caro_icon", f); buildLobbyPicker(); socket.emit("changeIcon", { roomId: S.roomId, icon: f }); }
  toast("⚠ Icon đã bị dùng, tự đổi sang cái khác");
});
function renderLobby(players, maxP) {
  const c = document.getElementById("lobbyPlayers");
  const isHost = players.length > 0 && players[0].playerId === MY_ID;
  c.innerHTML = players.map((p, idx) => {
    const cls = iconCls(p.icon || p.symbol), isMe = p.playerId === MY_ID;
    const colorStyle = p.color ? ` style="color:${p.color}"` : "";
    const kickBtn = (isHost && !isMe && idx !== 0)
      ? `<button class="kick-btn" onclick="kickPlayer('${p.playerId}')" title="Kick khỏi phòng">⚡ Kick</button>` : "";
    const displayName = p.username || (isMe ? "Bạn" : p.playerId.slice(0, 7));
    return `<div class="lp-card ${p.ready ? "ready" : ""}">
      <div class="lp-ico${cls ? " " + cls : ""}"${colorStyle}>${p.icon || p.symbol}</div>
      <div class="lp-sym">${p.symbol}</div>
      <div class="lp-name">${displayName}${idx === 0 ? " 👑" : ""}</div>
      <div class="lp-st">${p.ready ? "✅ Sẵn sàng" : "⏳ Chờ"}</div>
      ${kickBtn}
    </div>`;
  }).join("") + Array.from(
    { length: Math.min(2, Math.max(0, (maxP >= 999 ? players.length + 1 : maxP) - players.length)) },
    () => '<div class="empty-slot">Chờ...</div>'
  ).join("");
}
function kickPlayer(targetPlayerId) {
  uiConfirm("Kick người chơi này khỏi phòng?", () => {
    socket.emit("kickPlayer", { roomId: S.roomId, targetPlayerId });
    toast("⚡ Đã kick người chơi.");
  });
}
document.getElementById("btnReady").onclick = () => {
  const b = document.getElementById("btnReady");
  if (b.dataset.ready === "1") { socket.emit("cancelReady", { roomId: S.roomId }); }
  else { socket.emit("playerReady", { roomId: S.roomId }); }
};
document.getElementById("btnHostStart").onclick = () => socket.emit("hostStart", { roomId: S.roomId });
document.getElementById("btnLeaveLobby").onclick = () => leaveRoom();

/* ── BOT SETUP ── */
document.getElementById("btnStartBot").onclick = () => {
  const size = +document.getElementById("botBoardSize").value;
  const wc = +document.getElementById("botWinCount").value;
  const dirs = [...document.querySelectorAll('input[name="botDir"]:checked')].map(c => c.value);
  const diff = document.querySelector('input[name="botDiff"]:checked')?.value || "medium";
  const timePerTurn = +document.getElementById("botTimePerTurn").value || 30;
  if (!dirs.length) { toast("⚠ Chọn ít nhất 1 hướng!"); return; }
  Object.assign(S, { size, winCount: wc, dirs, sym: "X", icon: myIcon, color: myColor, turn: "X", started: true, over: false, bot: true, botDiff: diff, roomId: "BOT", timePerTurn });
  startGameScreen(null);
  const cls = iconCls(myIcon);
  document.getElementById("playersBar").innerHTML =
    `<div class="p-chip active" id="chip-X"><span class="ci${cls ? " " + cls : ""}" style="color:${myColor}">${myIcon}</span> X — Bạn</div>
     <div class="p-chip" id="chip-O"><span class="ci">🤖</span> O — Máy</div>`;
  botBoard = Array(size * size).fill("");
  makeBoard(size); setTurn(); startBotTimer();
};

/* ── BOT AI ── */
let botBoard = [];
let _botTimer = null;
let _botMoveId = 0;

function startBotTimer() {
  clearInterval(_botTimer);
  if (!S.bot || S.over || !S.started) return;
  let left = S.timePerTurn;
  const td = document.getElementById("timerDisplay");
  if (td) { td.textContent = left; td.className = "gb-timer" + (left <= 5 ? " low" : ""); }
  _botTimer = setInterval(() => {
    if (S.over || !S.started) { clearInterval(_botTimer); return; }
    left--;
    if (td) { td.textContent = left; td.className = "gb-timer" + (left <= 5 ? " low" : ""); }
    if (left <= 0) {
      clearInterval(_botTimer); if (S.over) return;
      S.over = true; S.started = false;
      if (S.turn === "X") { showResult("Hết giờ! 😢", "Bạn đã không đánh kịp!"); addStat("lose"); }
      else { showResult("Bạn thắng! 🎉", "Máy hết giờ!"); confetti(); addStat("win"); }
      document.getElementById("actions")?.classList.remove("hidden"); updateStats();
    }
  }, 1000);
}
function stopBotTimer() { clearInterval(_botTimer); }

function botMove() {
  if (S.over || S.turn !== "O") return;
  document.getElementById("board").classList.add("board-disabled");
  const delay = { easy: 300, normal: 450, medium: 650, hard: 850, expert: 1000 }[S.botDiff] ?? 650;
  const moveId = ++_botMoveId;
  setTimeout(() => {
    // Nếu moveId không khớp → game đã restart, bỏ qua nước đi này
    if (moveId !== _botMoveId || S.over || S.turn !== "O") return;
    const i = pickBot();
    if (i !== -1) { botBoard[i] = "O"; placeBotCell(i, "O"); }
  }, delay);
}

function pickBot() {
  if (S.botDiff === "easy") return randMove();
  if (S.botDiff === "normal") { const w = findWin("O"); if (w !== -1) return w; const b = findWin("X"); if (b !== -1) return b; return stratMove(); }
  if (S.botDiff === "medium") { const w = findWin("O"); if (w !== -1) return w; const b = findWin("X"); if (b !== -1) return b; return mediumMove(); }
  if (S.botDiff === "hard") { const w = findWin("O"); if (w !== -1) return w; const b = findWin("X"); if (b !== -1) return b; return hardMove(3); }
  const w = findWin("O"); if (w !== -1) return w; const b = findWin("X"); if (b !== -1) return b; return hardMove(4);
}
function randMove() { const e = botBoard.map((v, i) => v === "" ? i : -1).filter(i => i !== -1); return e.length ? e[Math.floor(Math.random() * e.length)] : -1; }
function findWin(sym) { for (let i = 0; i < botBoard.length; i++) { if (botBoard[i] !== "") continue; botBoard[i] = sym; if (winCheck(i, sym)) { botBoard[i] = ""; return i; } botBoard[i] = ""; } return -1; }
function stratMove() {
  const sz = S.size, occ = botBoard.map((v, i) => v !== "" ? i : -1).filter(i => i !== -1);
  if (!occ.length) return Math.floor(botBoard.length / 2);
  let best = -1, bs = -1;
  for (let i = 0; i < botBoard.length; i++) {
    if (botBoard[i] !== "") continue; let sc = 0;
    const r = Math.floor(i / sz), c = i % sz;
    for (const o of occ) { const d = Math.max(Math.abs(Math.floor(o / sz) - r), Math.abs(o % sz - c)); if (d <= 2) sc += (3 - d); }
    botBoard[i] = "O"; sc += chain(i, "O") * 3; botBoard[i] = "X"; sc += chain(i, "X") * 2; botBoard[i] = "";
    if (sc > bs) { bs = sc; best = i; }
  }
  return best !== -1 ? best : randMove();
}
const MM_WIN = 10_000_000;
const MM_DEPTH = 4;
function mmLineScore(cnt, openB, openE, wc) {
  if (cnt >= wc) return MM_WIN;
  const op = (openB ? 1 : 0) + (openE ? 1 : 0); if (!op) return 0;
  const d = wc - cnt;
  if (d === 1) return op === 2 ? 500_000 : 150_000;
  if (d === 2) return op === 2 ?  80_000 :   8_000;
  if (d === 3) return op === 2 ?   3_000 :     300;
  if (d === 4) return op === 2 ?     100 :      10;
  return 1;
}
function mmScoreFor(sym) {
  const sz = S.size, wc = S.winCount; let total = 0;
  for (const [dx, dy, nm] of [[1,0,"horizontal"],[0,1,"vertical"],[1,1,"diagonal"],[1,-1,"diagonal"]]) {
    if (!S.dirs.includes(nm)) continue;
    for (let r = 0; r < sz; r++) for (let c = 0; c < sz; c++) {
      const pr = r - dy, pc = c - dx;
      if (pr>=0&&pr<sz&&pc>=0&&pc<sz&&botBoard[pr*sz+pc]===sym) continue;
      if (botBoard[r*sz+c] !== sym) continue;
      let cnt = 1, nr = r+dy, nc = c+dx;
      while (nr>=0&&nr<sz&&nc>=0&&nc<sz&&botBoard[nr*sz+nc]===sym) { cnt++; nr+=dy; nc+=dx; }
      const openB = pr>=0&&pr<sz&&pc>=0&&pc<sz && botBoard[pr*sz+pc]==="";
      const openE = nr>=0&&nr<sz&&nc>=0&&nc<sz && botBoard[nr*sz+nc]==="";
      total += mmLineScore(cnt, openB, openE, wc);
    }
  }
  return total;
}
function mmEvalBoard() { return mmScoreFor("O") - mmScoreFor("X") * 1.25; }
function mmWins(idx, sym) {
  const sz = S.size, wc = S.winCount, r = Math.floor(idx / sz), c = idx % sz;
  for (const [dx, dy, nm] of [[1,0,"horizontal"],[0,1,"vertical"],[1,1,"diagonal"],[1,-1,"diagonal"]]) {
    if (!S.dirs.includes(nm)) continue; let n = 1;
    for (let s=1;s<wc;s++){const nr=r+dy*s,nc=c+dx*s;if(nr<0||nr>=sz||nc<0||nc>=sz||botBoard[nr*sz+nc]!==sym)break;n++;}
    for (let s=1;s<wc;s++){const nr=r-dy*s,nc=c-dx*s;if(nr<0||nr>=sz||nc<0||nc>=sz||botBoard[nr*sz+nc]!==sym)break;n++;}
    if (n >= wc) return true;
  }
  return false;
}
function mmCandidates() {
  const sz = S.size, s = new Set();
  for (let i = 0; i < botBoard.length; i++) {
    if (botBoard[i] === "") continue;
    const r = Math.floor(i / sz), c = i % sz;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const nr = r+dr, nc = c+dc;
      if (nr>=0&&nr<sz&&nc>=0&&nc<sz&&botBoard[nr*sz+nc]==="") s.add(nr*sz+nc);
    }
  }
  if (!s.size) s.add(Math.floor(botBoard.length / 2));
  return [...s];
}
function mmOrderMoves(cands, sym) {
  const opp = sym === "O" ? "X" : "O";
  return cands.filter(i => botBoard[i] === "").map(i => {
    botBoard[i] = sym; const atk = mmScoreFor(sym);
    botBoard[i] = opp; const def = mmScoreFor(opp);
    botBoard[i] = ""; return { i, s: atk + def * 1.25 };
  }).sort((a, b) => b.s - a.s).slice(0, 20).map(x => x.i);
}
function mmOrderFast(cands) {
  const sz = S.size;
  return cands.filter(i => botBoard[i] === "").map(i => {
    const r = Math.floor(i/sz), c = i%sz; let sc = 0;
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
      if (!dr&&!dc) continue; const nr=r+dr,nc=c+dc;
      if (nr>=0&&nr<sz&&nc>=0&&nc<sz&&botBoard[nr*sz+nc]!=="") sc++;
    }
    return { i, sc };
  }).sort((a, b) => b.sc - a.sc).slice(0, 15).map(x => x.i);
}
function mmAlphaBeta(depth, alpha, beta, isMax) {
  if (depth === 0) return mmEvalBoard();
  const cands = mmCandidates(); if (!cands.length) return mmEvalBoard();
  const sorted = depth >= 2 ? mmOrderMoves(cands, isMax ? "O" : "X") : mmOrderFast(cands);
  if (isMax) {
    let val = -Infinity;
    for (const i of sorted) {
      botBoard[i] = "O";
      const sc = mmWins(i, "O") ? MM_WIN + depth : mmAlphaBeta(depth-1, alpha, beta, false);
      botBoard[i] = "";
      if (sc > val) val = sc; if (val > alpha) alpha = val;
      if (alpha >= beta || val >= MM_WIN) break;
    }
    return val;
  } else {
    let val = Infinity;
    for (const i of sorted) {
      botBoard[i] = "X";
      const sc = mmWins(i, "X") ? -MM_WIN - depth : mmAlphaBeta(depth-1, alpha, beta, true);
      botBoard[i] = "";
      if (sc < val) val = sc; if (val < beta) beta = val;
      if (alpha >= beta || val <= -MM_WIN) break;
    }
    return val;
  }
}
function mediumMove() {
  const cands = mmCandidates(); if (!cands.length) return stratMove();
  let bestIdx = -1, bestScore = -Infinity;
  for (const i of cands) {
    if (botBoard[i] !== "") continue;
    botBoard[i] = "O"; const atk = mmScoreFor("O");
    botBoard[i] = "X"; const def = mmScoreFor("X");
    botBoard[i] = ""; const sc = atk + def * 1.2;
    if (sc > bestScore) { bestScore = sc; bestIdx = i; }
  }
  return bestIdx !== -1 ? bestIdx : stratMove();
}
function hardMove(depth = MM_DEPTH) {
  if (botBoard.every(c => c === "")) return Math.floor(botBoard.length / 2);
  const cands = mmCandidates(); if (!cands.length) return stratMove();
  const ordered = mmOrderMoves(cands, "O");
  let bestIdx = ordered[0] ?? -1, bestScore = -Infinity;
  for (const i of ordered) {
    botBoard[i] = "O";
    const sc = mmAlphaBeta(depth - 1, -Infinity, Infinity, false);
    botBoard[i] = "";
    if (sc > bestScore) { bestScore = sc; bestIdx = i; }
    if (bestScore >= MM_WIN) break;
  }
  return bestIdx !== -1 ? bestIdx : stratMove();
}
function mmHintMove() {
  const cands = mmCandidates(); if (!cands.length) return stratMove();
  const ordered = mmOrderMoves(cands, "X");
  let best = ordered[0], bs = Infinity;
  for (const i of ordered) {
    botBoard[i] = "X";
    const sc = mmWins(i, "X") ? -MM_WIN : mmAlphaBeta(Math.min(MM_DEPTH-1, 2), -Infinity, Infinity, true);
    botBoard[i] = ""; if (sc < bs) { bs = sc; best = i; }
  }
  return best;
}
function detectThreats(opSym) {
  const sz = S.size, wc = S.winCount;
  const dirs = [[1,0,"horizontal"],[0,1,"vertical"],[1,1,"diagonal"],[1,-1,"diagonal"]];
  const threats = [];
  for (const [dx, dy, nm] of dirs) {
    if (!S.dirs.includes(nm)) continue;
    for (let r = 0; r < sz; r++) for (let c = 0; c < sz; c++) {
      const idx = r * sz + c; if (botBoard[idx] !== opSym) continue;
      const pr = r - dy, pc = c - dx;
      if (pr >= 0 && pr < sz && pc >= 0 && pc < sz && botBoard[pr*sz+pc] === opSym) continue;
      let cnt = 1, cells = [idx], nr = r + dy, nc = c + dx;
      while (nr>=0&&nr<sz&&nc>=0&&nc<sz&&botBoard[nr*sz+nc]===opSym) { cells.push(nr*sz+nc); cnt++; nr+=dy; nc+=dx; }
      const endR = nr, endC = nc;
      const openFront = pr>=0&&pr<sz&&pc>=0&&pc<sz&&botBoard[pr*sz+pc]==="";
      const openEnd   = nr>=0&&nr<sz&&nc>=0&&nc<sz&&botBoard[nr*sz+nc]==="";
      const opens = (openFront?1:0) + (openEnd?1:0);
      if (opens === 0) continue;
      const missing = wc - cnt;
      if (missing <= 0) { threats.push({ level: 4, cells, block: -1, label: "Đối thủ đã thắng!" }); }
      else if (missing === 1) { const blockIdx = openEnd ? (endR*sz+endC) : (pr*sz+pc); threats.push({ level: 3, cells, block: blockIdx, label: opens===2 ? `Chặn chuỗi ${cnt} hở 2 đầu (thắng ngay!)` : `Chặn chuỗi ${cnt} (đe dọa thắng)` }); }
      else if (missing === 2 && opens === 2) { threats.push({ level: 2, cells, block: openEnd ? (endR*sz+endC) : (pr*sz+pc), label: `Chặn chuỗi ${cnt} hở 2 đầu (sắp tạo đòn đôi)` }); }
      else if (missing === 2 && opens === 1) { threats.push({ level: 1, cells, block: openEnd ? (endR*sz+endC) : (pr*sz+pc), label: `Cảnh báo chuỗi ${cnt} của đối thủ` }); }
    }
  }
  threats.sort((a, b) => b.level - a.level); return threats;
}
function detectFork(opSym) {
  const threats = detectThreats(opSym).filter(t => t.level >= 2); if (threats.length < 2) return null;
  const cands = mmCandidates();
  for (const i of cands) {
    if (botBoard[i] !== "") continue;
    botBoard[i] = "X"; const remaining = detectThreats(opSym).filter(t => t.level >= 2); botBoard[i] = "";
    if (remaining.length < threats.length - 1) return { block: i, label: "Phá đòn đôi của đối thủ!" };
  }
  return { block: threats[0].block, label: "Chặn đòn nguy hiểm nhất!" };
}
function hintMoves(topN = 3) {
  const results = [];
  const winNow = findWin("X"); if (winNow !== -1) return [{ idx: winNow, label: "🏆 Đánh ô này để thắng ngay!" }];
  const blockNow = findWin("O"); if (blockNow !== -1) results.push({ idx: blockNow, label: "🚨 Chặn ngay! Đối thủ sắp thắng" });
  if (results.length === 0) { const fork = detectFork("O"); if (fork) results.push({ idx: fork.block, label: "⚠️ " + fork.label }); }
  const cands = mmCandidates(); if (!cands.length) return results.length ? results : [{ idx: stratMove(), label: "💡 Nước đi hợp lý" }];
  const ordered = mmOrderMoves(cands, "X"); const scored = [];
  for (const i of ordered) {
    if (results.some(r => r.idx === i)) continue;
    botBoard[i] = "X"; let sc; if (mmWins(i, "X")) { sc = MM_WIN; } else { sc = -mmAlphaBeta(3, -Infinity, Infinity, true); } botBoard[i] = "";
    botBoard[i] = "X"; const threatAfter = detectThreats("O").filter(t => t.level >= 2).length; botBoard[i] = "";
    const threatBefore = detectThreats("O").filter(t => t.level >= 2).length;
    scored.push({ idx: i, sc: sc + (threatBefore - threatAfter) * 50000 });
  }
  scored.sort((a, b) => b.sc - a.sc);
  const labels = ["💡 Nước đi tốt nhất", "✨ Lựa chọn thay thế", "🔵 Nước đi khác"];
  for (let k = 0; k < Math.min(topN - results.length, scored.length); k++) {
    const item = scored[k]; let label = labels[k] || "🔵 Gợi ý";
    botBoard[item.idx] = "X"; const chain4 = detectThreats("X").find(t => t.level >= 3); const chain3 = detectThreats("X").find(t => t.level === 2); botBoard[item.idx] = "";
    if (k === 0 && chain4) label = "💡 Tạo chuỗi " + (S.winCount-1) + " — gần thắng!";
    else if (k === 0 && chain3) label = "💡 Xây thế tấn công mạnh";
    results.push({ idx: item.idx, label });
  }
  return results.slice(0, topN);
}
function candidates() {
  const sz = S.size, s = new Set();
  for (let i = 0; i < botBoard.length; i++) { if (botBoard[i] === "") continue; const r = Math.floor(i / sz), c = i % sz; for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) { const nr = r + dr, nc = c + dc; if (nr >= 0 && nr < sz && nc >= 0 && nc < sz && botBoard[nr * sz + nc] === "") s.add(nr * sz + nc); } }
  if (!s.size) s.add(Math.floor(botBoard.length / 2)); return [...s];
}
function scoreAll(sym) { let t = 0; for (let i = 0; i < botBoard.length; i++) if (botBoard[i] === sym) t += chain(i, sym); return t; }
function chain(idx, sym) {
  const sz = S.size, r = Math.floor(idx / sz), c = idx % sz; let mx = 0;
  for (const [dx, dy] of [[1,0],[0,1],[1,1],[1,-1]]) {
    let n = 1;
    for (let d = 1; d < 6; d++) { const nr = r+dy*d, nc = c+dx*d; if (nr<0||nr>=sz||nc<0||nc>=sz||botBoard[nr*sz+nc]!==sym) break; n++; }
    for (let d = 1; d < 6; d++) { const nr = r-dy*d, nc = c-dx*d; if (nr<0||nr>=sz||nc<0||nc>=sz||botBoard[nr*sz+nc]!==sym) break; n++; }
    if (n > mx) mx = n;
  }
  return mx;
}
function winCheck(idx, sym) {
  const sz = S.size, r = Math.floor(idx / sz), c = idx % sz;
  for (const d of [{n:"horizontal",dx:1,dy:0},{n:"vertical",dx:0,dy:1},{n:"diagonal",dx:1,dy:1},{n:"diagonal",dx:1,dy:-1}]) {
    if (!S.dirs.includes(d.n)) continue;
    let cells = [[r,c]], cr = r+d.dy, cc = c+d.dx;
    while (cr>=0&&cr<sz&&cc>=0&&cc<sz&&botBoard[cr*sz+cc]===sym) { cells.push([cr,cc]); cr+=d.dy; cc+=d.dx; }
    cr = r-d.dy; cc = c-d.dx;
    while (cr>=0&&cr<sz&&cc>=0&&cc<sz&&botBoard[cr*sz+cc]===sym) { cells.push([cr,cc]); cr-=d.dy; cc-=d.dx; }
    if (cells.length >= S.winCount) return cells;
  }
  return null;
}
function placeBotCell(idx, sym) {
  const board = document.getElementById("board"), cell = board.children[idx]; if (!cell) return;
  cell.textContent = sym === "O" ? "🤖" : (S.icon || "✕");
  cell.dataset.taken = "1"; cell.classList.remove("x-cell","o-cell");
  cell.classList.add(sym === "X" ? "x-cell" : "o-cell");
  if (sym === "X" && S.color) cell.style.color = S.color; else cell.style.color = "";
  board.querySelectorAll(".last-move").forEach(c => c.classList.remove("last-move")); cell.classList.add("last-move");
  const wc = winCheck(idx, sym);
  if (wc) {
    wc.forEach(([row,col]) => board.children[row*S.size+col]?.classList.add("win"));
    S.over = true; S.started = false; board.classList.remove("board-disabled"); stopBotTimer();
    const win = sym === "X"; document.getElementById("popupEmoji").textContent = win ? "🎉" : "😢";
    if (win) confetti(); showResult(win ? "Bạn thắng!" : "Máy thắng!", win ? "Xuất sắc! 🏆" : "Thử lại nào! 💪");
    addStat(win ? "win" : "lose"); return;
  }
  if (botBoard.every(c => c !== "")) {
    S.over = true; S.started = false; board.classList.remove("board-disabled"); stopBotTimer();
    document.getElementById("popupEmoji").textContent = "🤝"; showResult("Hòa rồi!", "Không ai thắng"); addStat("draw"); return;
  }
  S.turn = sym === "X" ? "O" : "X"; updateChips(S.turn); setTurn();
  if (S.turn === "O") { stopBotTimer(); botMove(); } else { startBotTimer(); board.classList.remove("board-disabled"); }
}

/* ── HINT ── */
function wireRulesToggle() {
  const toggle = document.getElementById("rulesToggle"), detail = document.getElementById("rulesDetail");
  if (!toggle || !detail) return;
  toggle.onclick = () => { const hidden = detail.classList.toggle("hidden"); toggle.textContent = hidden ? "▼ Chi tiết" : "▲ Ẩn"; };
}
function doHint() {
  if (!S.bot || !S.started || S.over || S.turn !== "X") { toast("💡 Chỉ dùng được khi tới lượt bạn"); return; }
  clearHints();
  const topMoves = hintMoves(3); if (!topMoves.length) { toast("🤔 Không tìm được gợi ý"); return; }
  const board = document.getElementById("board");
  const hintClasses = ["hint-cell-2", "hint-cell", "hint-cell-3"];
  topMoves.forEach((move, idx) => { const cell = board.children[move.idx]; if (cell && !cell.dataset.taken) cell.classList.add(hintClasses[idx] || "hint-cell-3"); });
  toast(topMoves[0].label + (topMoves.length > 1 ? ` (+${topMoves.length-1} lựa chọn khác)` : ""));
  setTimeout(() => clearHints(), 3500);
}
function clearHints() { document.querySelectorAll(".hint-cell,.hint-cell-2,.hint-cell-3").forEach(c => c.classList.remove("hint-cell","hint-cell-2","hint-cell-3")); }

/* ── CONFETTI ── */
function confetti() {
  const c = document.getElementById("popupConfetti"); if (!c) return; c.innerHTML = "";
  const cols = ["#c8992a","#e0b040","#4a9652","#c84040","#4a7ab8","#b8a060"];
  for (let i = 0; i < 20; i++) {
    const d = document.createElement("div"); d.className = "c-dot";
    const sz = Math.random() * 7 + 4;
    d.style.cssText = `width:${sz}px;height:${sz}px;left:${Math.random()*100}%;top:${Math.random()*15}%;background:${cols[~~(Math.random()*cols.length)]};animation-delay:${Math.random()*.5}s;animation-duration:${1+Math.random()}s`;
    c.appendChild(d);
  }
}

/* ── GAME START (multi) ── */
socket.on("gameStart", ({ turn, time, players }) => {
  hideCountdown();
  Object.assign(S, { started: true, over: false, turn, bot: false });
  startGameScreen(players); document.getElementById("timerDisplay").textContent = time;
  renderChips(players, turn); makeBoard(S.size); setTurn(); clearChat(); addSysMsg("🎯 Ván đấu bắt đầu!");
});

/* ── BUILD GAME LAYOUT ── */
function startGameScreen(players) {
  go("screen-game");
  document.getElementById("roomDisplay").textContent = S.bot ? "🤖 vs Máy" : "🏠 " + S.roomId;
  const gl = document.getElementById("gameLayout");
  function buildRulesHTML() {
    const dirMap = { horizontal: "Ngang", vertical: "Dọc", diagonal: "Chéo" };
    const dirText = (S.dirs || []).map(d => dirMap[d] || d).join(" · ") || "—";
    const diff = S.bot ? ({ easy:"🌱 Dễ", normal:"🐣 Bình thường", medium:"⚡ Trung bình", hard:"🔥 Khó", expert:"💀 Chuyên gia" }[S.botDiff] || "") : "";
    return `<div class="rules-bar" id="rulesBar"><div class="rules-summary" id="rulesSummary">📋 Luật: bàn <b>${S.size}×${S.size}</b> · thắng <b>${S.winCount} ô liên tiếp</b> · hướng: <b>${dirText}</b>${diff ? ` · ${diff}` : ""}<span class="rules-toggle" id="rulesToggle">▼ Chi tiết</span></div><div class="rules-detail hidden" id="rulesDetail"><ul><li>🎯 Nối <b>${S.winCount} quân liên tiếp</b> theo hướng cho phép để thắng</li><li>📐 Hướng được phép: <b>${dirText}</b></li><li>⏱ Mỗi lượt có <b>${S.timePerTurn} giây</b> — hết giờ bị thua lượt</li>${S.bot ? `<li>🤖 Độ khó máy: <b>${diff}</b></li>` : `<li>🏳 Đầu hàng nếu không muốn tiếp tục</li>`}</ul></div></div>`;
  }
  if (S.bot) {
    gl.className = "game-layout-bot";
    gl.innerHTML = `<div class="board-side"><div class="board-outer"><div id="board" class="board-grid"></div></div>${buildRulesHTML()}<div class="in-game-acts" id="inGameActs"><button class="act-btn hint-btn" id="btnHint">💡 Gợi ý</button></div><div class="game-acts hidden" id="actions"><button class="btn-ghost" id="restartBtn">↺ Chơi lại</button><button class="btn-danger" id="leaveBtn">✕ Thoát</button></div></div>`;
    document.getElementById("btnHint").onclick = doHint;
    document.getElementById("restartBtn").onclick = restart;
    document.getElementById("leaveBtn").onclick = () => leaveRoom();
    wireRulesToggle();
  } else {
    gl.className = "game-layout-online";
    gl.innerHTML = `<div class="board-side"><div class="board-outer"><div id="board" class="board-grid"></div></div>${buildRulesHTML()}<div class="in-game-acts" id="inGameActs"><button class="act-btn surr-btn" id="btnSurrender">🏳 Đầu hàng</button></div><div class="game-acts hidden" id="actions"><button class="btn-ghost" id="restartBtn">↺ Chơi lại</button><button class="btn-danger" id="leaveBtn">✕ Thoát</button></div></div><div class="chat-side" id="chatSide"><div class="chat-head">Chat</div><div class="chat-msgs" id="chatMsgs"></div><div class="chat-reacts"><button class="react-btn" data-msg="👍">👍</button><button class="react-btn" data-msg="😂">😂</button><button class="react-btn" data-msg="🔥">🔥</button><button class="react-btn" data-msg="😱">😱</button><button class="react-btn" data-msg="GG! 🏆">🏆</button></div><div class="chat-row"><input type="text" id="chatInput" class="chat-inp" placeholder="Nhắn gì đó..." maxlength="80"/><button class="chat-send" id="chatSend">↑</button></div></div>`;
    document.getElementById("btnSurrender").onclick = () => {
      if (!S.started || S.over) return;
      uiConfirm("Bạn có chắc muốn đầu hàng?", () => socket.emit("surrender", { roomId: S.roomId }));
    };
    document.getElementById("restartBtn").onclick = restart;
    document.getElementById("leaveBtn").onclick = () => leaveRoom();
    wireRulesToggle();
    document.getElementById("chatSend").onclick = sendChat;
    document.getElementById("chatInput").onkeydown = e => { if (e.key === "Enter") sendChat(); };
    document.querySelectorAll(".react-btn").forEach(b => b.onclick = () => { if (S.roomId) socket.emit("chatMsg", { roomId: S.roomId, text: b.dataset.msg }); });
  }
}

function renderChips(players, cur) {
  document.getElementById("playersBar").innerHTML = players.map(p => {
    const cls = iconCls(p.icon || p.symbol), colorStyle = p.color ? ` style="color:${p.color}"` : "";
    return `<div class="p-chip ${p.symbol === cur ? "active" : ""}" id="chip-${p.symbol}"><span class="ci${cls ? " " + cls : ""}"${colorStyle}>${p.icon || p.symbol}</span> ${p.symbol}${p.playerId === MY_ID ? " — Bạn" : ""}</div>`;
  }).join("");
}
function updateChips(t) { document.querySelectorAll(".p-chip").forEach(c => c.classList.remove("active")); document.getElementById("chip-" + t)?.classList.add("active"); }

/* ── BOARD ── */
function makeBoard(sz) {
  const board = document.getElementById("board"); board.innerHTML = "";
  const cs = sz >= 20 ? 26 : sz >= 15 ? 32 : sz >= 10 ? 40 : 50;
  board.style.gridTemplateColumns = `repeat(${sz},${cs}px)`; board.style.width = (cs * sz) + "px";
  const f = document.createDocumentFragment();
  for (let i = 0; i < sz * sz; i++) {
    const cell = document.createElement("div"); cell.className = "cell"; cell.style.cssText = `width:${cs}px;height:${cs}px;font-size:${cs*.48}px`;
    cell.onclick = () => cellClick(cell, i); f.appendChild(cell);
  }
  board.appendChild(f);
}
function cellClick(cell, idx) {
  if (!S.started || S.over || cell.dataset.taken) return; clearHints();
  if (S.bot) { if (S.turn !== "X") return; botBoard[idx] = "X"; placeBotCell(idx, "X"); }
  else {
    if (S.turn !== S.sym) return;
    const board = document.getElementById("board"); board.classList.add("board-disabled");
    let ack = false;
    const fb = setTimeout(() => { if (!ack && !S.over && S.turn === S.sym) board.classList.remove("board-disabled"); }, 3000);
    socket.once("moveMade", () => { ack = true; clearTimeout(fb); });
    socket.emit("makeMove", { roomId: S.roomId, index: idx });
  }
}
socket.on("moveMade", ({ index, symbol, icon, color, turn, timeLeft, win, winCells }) => {
  const board = document.getElementById("board"), cell = board.children[index]; if (!cell) return;
  cell.textContent = icon || symbol; cell.dataset.taken = "1";
  cell.classList.remove("x-cell","o-cell"); cell.classList.add(symbol === "X" ? "x-cell" : "o-cell");
  if (color) cell.style.color = color; else cell.style.color = "";
  board.querySelectorAll(".last-move").forEach(c => c.classList.remove("last-move")); cell.classList.add("last-move");
  S.turn = turn; setTurn(); updateChips(turn);
  const td = document.getElementById("timerDisplay"); td.textContent = timeLeft; td.className = "gb-timer" + (timeLeft <= 5 ? " low" : "");
  if (win && winCells) winCells.forEach(i => board.children[i]?.classList.add("win"));
});
socket.on("timerUpdate", ({ timeLeft }) => {
  const td = document.getElementById("timerDisplay"); td.textContent = timeLeft; td.className = "gb-timer" + (timeLeft <= 5 ? " low" : "");
});
socket.on("turnSkipped", ({ skipped, turn }) => {
  S.turn = turn; addSysMsg(skipped === S.sym ? "⏰ Bạn hết giờ! Bỏ lượt." : "⏰ Đối thủ hết giờ! Đến lượt bạn."); setTurn();
});

/* ── ELO UPDATE ── */
socket.on("eloUpdate", ({ delta, newElo, isWinner, isDraw }) => {
  window._lastEloUpdate = { delta, newElo, isWinner, isDraw };
  window._lastElo = newElo;
});

/* ── CHAT ── */
function clearChat() { const el = document.getElementById("chatMsgs"); if (el) el.innerHTML = ""; }
function addSysMsg(text) {
  const el = document.getElementById("chatMsgs"); if (!el) return;
  const d = document.createElement("div"); d.className = "chat-msg sys"; d.textContent = text;
  el.appendChild(d); el.scrollTop = el.scrollHeight;
}
function addChatMsg(icon, sym, text, isMe) {
  const el = document.getElementById("chatMsgs"); if (!el) return;
  const d = document.createElement("div"); d.className = "chat-msg";
  d.innerHTML = `<div class="cm-who">${icon || sym} ${sym}${isMe ? " (bạn)" : ""}</div><div class="cm-text">${esc(text)}</div>`;
  el.appendChild(d); el.scrollTop = el.scrollHeight;
}
function esc(t) { return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function sendChat() {
  const inp = document.getElementById("chatInput"); if (!inp) return;
  const text = inp.value.trim(); if (!text) return;
  socket.emit("chatMsg", { roomId: S.roomId, text }); inp.value = "";
}
socket.on("chatMsg", ({ symbol, icon, text }) => { addChatMsg(icon, symbol, text, symbol === S.sym); });

/* ── GAME OVER ── */
socket.on("gameOver", async ({ winner, reason, loser }) => {
  S.over = true; S.started = false;
  hideCountdown();
  document.getElementById("board")?.classList.remove("board-disabled");

  let emoji = "", title = "", detail = "";
  if (reason === "draw") { emoji = "🤝"; title = "Hòa!"; detail = "Hết ô! Không ai thắng"; }
  else if (reason === "surrender" && loser === S.sym) { emoji = "🏳"; title = "Đầu hàng"; detail = "Thử lại lần sau!"; }
  else if (reason === "surrender" && winner === S.sym) { emoji = "🎉"; title = "Bạn thắng!"; detail = "Đối thủ đầu hàng!"; confetti(); }
  else if (winner === S.sym) { emoji = "🎉"; title = "Bạn thắng!"; detail = reason === "timeout" ? "Đối thủ hết giờ" : reason === "disconnect" ? "Đối thủ bỏ cuộc" : "Xuất sắc!"; confetti(); }
  else { emoji = "😢"; title = "Bạn thua!"; detail = reason === "timeout" ? "Hết giờ!" : reason === "disconnect" ? "Đối thủ bỏ cuộc" : "Thử lại nào!"; }
  document.getElementById("popupEmoji").textContent = emoji;

  socket.emit("gameOverHandled", { roomId: S.roomId, winner, reason });

  const user = window.getAuthUser ? window.getAuthUser() : null;
  if (user && window.loadStatsFromDB) {
    await new Promise(r => setTimeout(r, 600));
    await window.loadStatsFromDB();
  } else {
    const ls = getLocalStats();
    if (reason === "draw") ls.draw++;
    else if (winner === S.sym) ls.win++;
    else if (loser === S.sym || (winner && winner !== S.sym)) ls.lose++;
    saveLocalStats(ls);
  }

  const s = getStats();
  const total = s.win + s.lose + s.draw, wr = total ? Math.round(s.win / total * 100) : 0;
  document.getElementById("resultStats").innerHTML =
    `<div class="rs-it"><span class="rs-n">${s.win}</span><span class="rs-l">Thắng</span></div>
     <div class="rs-it"><span class="rs-n">${s.draw}</span><span class="rs-l">Hòa</span></div>
     <div class="rs-it"><span class="rs-n">${s.lose}</span><span class="rs-l">Thua</span></div>
     <div class="rs-it"><span class="rs-n">${wr}%</span><span class="rs-l">Tỉ lệ</span></div>`;

  showResult(title, detail);
  updateStats();
});

/* ── TURN ── */
function setTurn() {
  const td = document.getElementById("turnDisplay"), board = document.getElementById("board");
  if (!td || !board) return;
  if (S.over || !S.started) { board.classList.remove("board-disabled"); td.className = "gb-turn"; return; }
  if (S.bot) {
    if (S.turn === "X") { td.textContent = "Lượt của bạn"; td.className = "gb-turn my"; board.classList.remove("board-disabled"); }
    else { td.textContent = "Máy đang nghĩ..."; td.className = "gb-turn"; board.classList.add("board-disabled"); }
  } else {
    const mine = S.turn === S.sym;
    td.textContent = mine ? "Tới lượt bạn!" : "Đối thủ đang đánh...";
    td.className = "gb-turn" + (mine ? " my" : "");
    mine ? board.classList.remove("board-disabled") : board.classList.add("board-disabled");
  }
}

/* ── RESULT ── */
function showResult(title, detail) {
  document.getElementById("resultTitle").textContent = title;
  document.getElementById("resultReason").textContent = detail;

  // Hiển thị ELO delta nếu có
  const eloEl = document.getElementById("resultElo");
  if (eloEl && window._lastEloUpdate) {
    const { delta, newElo, isDraw } = window._lastEloUpdate;
    const sign = delta >= 0 ? "+" : "";
    const color = delta > 0 ? "#62b86c" : delta < 0 ? "#b84040" : "#8a8570";
    eloEl.innerHTML = `
      <span style="color:${color};font-weight:700;font-size:16px;font-family:'Courier New',monospace">
        ${sign}${delta} ELO
      </span>
      <span style="color:var(--sub);font-size:12px;margin-left:6px">
        → ${newElo}
      </span>
    `;
    eloEl.classList.remove("hidden");
    window._lastEloUpdate = null;
  } else if (eloEl) {
    eloEl.classList.add("hidden");
  }

  document.getElementById("resultPopup").classList.remove("hidden");
  document.getElementById("actions")?.classList.remove("hidden");
}

function restart() {
  document.getElementById("resultPopup").classList.add("hidden");
  document.getElementById("popupConfetti").innerHTML = "";
  if (S.bot) {
    _botMoveId++;
    S.turn = "X"; S.started = true; S.over = false; stopBotTimer();
    botBoard = Array(S.size * S.size).fill(""); makeBoard(S.size);
    document.getElementById("board")?.classList.remove("board-disabled");
    document.getElementById("actions")?.classList.add("hidden");
    updateChips("X"); setTurn(); startBotTimer(); toast("↺ Ván mới!");
  } else {
    S.started = false; S.over = false; S.turn = "";
    socket.emit("resetReady", { roomId: S.roomId });
    go("screen-lobby");
    const b = document.getElementById("btnReady"); b.disabled = false; b.textContent = "✅ Sẵn sàng";
    const startBtn = document.getElementById("btnHostStart"); if (startBtn) startBtn.classList.add("hidden");
  }
}
document.getElementById("popupRestart").onclick = restart;
document.getElementById("popupLeave").onclick = () => leaveRoom();

/* ── RECONNECT ── */
socket.on("reconnectSuccess", ({ board, turn, timeLeft, yourSymbol, yourIcon, yourColor, started, gameOver, boardSize, winCount, winDirections, maxPlayers, timePerTurn, players }) => {
  hideReconnectOverlay();
  Object.assign(S, { sym: yourSymbol, icon: yourIcon, color: yourColor, turn, started: started && !gameOver, over: gameOver, size: boardSize, winCount, dirs: winDirections, maxP: maxPlayers, timePerTurn: timePerTurn || 30 });
  startGameScreen(players); document.getElementById("roomDisplay").textContent = "🏠 " + S.roomId;
  renderChips(players, turn); makeBoard(boardSize);
  const boardEl = document.getElementById("board");
  board.forEach((sym, i) => { if (sym) { const p = players.find(pl => pl.symbol === sym); const cell = boardEl.children[i]; cell.textContent = p?.icon || sym; cell.dataset.taken = "1"; cell.classList.add(sym === "X" ? "x-cell" : "o-cell"); if (p?.color) cell.style.color = p.color; } });
  document.getElementById("timerDisplay").textContent = timeLeft; setTurn(); toast("↩ Đã kết nối lại!");
});
socket.on("playerReconnected", () => { addSysMsg("↩ Đối thủ quay lại!"); setTimeout(setTurn, 1500); });
socket.on("reconnectFailed", () => { hideReconnectOverlay(); toast("❌ Mất kết nối!", 3000); setTimeout(() => leaveRoom(), 3000); });

/* ── STATS ── */
function getLocalStats() {
  try { return JSON.parse(localStorage.getItem("caro_stats")) || { win: 0, lose: 0, draw: 0 }; }
  catch { return { win: 0, lose: 0, draw: 0 }; }
}
function saveLocalStats(s) { localStorage.setItem("caro_stats", JSON.stringify(s)); }

function getStats() {
  const user = window.getAuthUser ? window.getAuthUser() : null;
  if (user && window.getDBStats) {
    const db = window.getDBStats();
    return { win: db.wins, lose: db.losses, draw: db.draws };
  }
  return getLocalStats();
}

function addStat(t) {
  const user = window.getAuthUser ? window.getAuthUser() : null;
  if (user) {
    setTimeout(async () => {
      if (window.loadStatsFromDB) await window.loadStatsFromDB();
      updateStats();
    }, 600);
  } else {
    const s = getLocalStats(); s[t]++; saveLocalStats(s); updateStats();
  }
}

function updateStats() {
  const s = getStats();
  const total = s.win + s.lose + s.draw;
  const wr = total ? Math.round(s.win / total * 100) + "%" : "—";
  document.getElementById("pbWin").textContent     = s.win;
  document.getElementById("pbDraw").textContent    = s.draw;
  document.getElementById("pbLose").textContent    = s.lose;
  document.getElementById("pbWinRate").textContent = "Tỉ lệ thắng : " + wr;
}