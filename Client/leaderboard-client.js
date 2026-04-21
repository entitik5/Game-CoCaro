// =============================================================================
//  LEADERBOARD-CLIENT.JS — Bảng xếp hạng dạng danh sách dọc
// =============================================================================

const LB_API = window.location.origin;

(function injectLeaderboardCSS() {
  const style = document.createElement("style");
  style.textContent = `
    /* ── SECTION WRAPPER ── */
    #leaderboardSection {
      width: 100%;
      max-width: 520px;
      margin: 24px auto 0;
      padding: 0 12px 36px;
      box-sizing: border-box;
    }

    /* ── HEADER ── */
    .lb-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }
    .lb-title {
      font-size: 13px;
      font-weight: 800;
      color: var(--gold, #c8992a);
      letter-spacing: 2.5px;
      text-transform: uppercase;
      font-family: var(--serif, serif);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .lb-title::before {
      content: '';
      display: inline-block;
      width: 3px;
      height: 14px;
      background: var(--gold, #c8992a);
      border-radius: 2px;
    }
    .lb-refresh {
      background: none;
      border: 1px solid var(--border, #2a2a2a);
      color: var(--dim, #666);
      font-size: 12px;
      cursor: pointer;
      padding: 4px 10px;
      border-radius: 20px;
      transition: all .2s;
      letter-spacing: .5px;
    }
    .lb-refresh:hover {
      color: var(--gold, #c8992a);
      border-color: var(--gold, #c8992a);
      background: rgba(200,153,42,.06);
    }
    .lb-refresh.spinning { animation: lb-spin .5s linear; }
    @keyframes lb-spin { to { transform: rotate(360deg); } }

    /* ── LIST ── */
    #lbList {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .lb-row {
      display: flex;
      align-items: stretch;
      border-radius: 9px;
      overflow: hidden;
      position: relative;
      transition: transform .15s, box-shadow .15s;
      animation: lb-slideIn .35s ease both;
      --lb-bg: var(--bg2);
      --lb-bg-rank: var(--bg3);
      --lb-accent: transparent;
      --lb-rank-color: var(--text-light);
    }
    .lb-row:hover { transform: translateX(4px); }

    @keyframes lb-slideIn {
      from { opacity: 0; transform: translateX(-14px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    .lb-row:nth-child(1)  { animation-delay: .03s }
    .lb-row:nth-child(2)  { animation-delay: .07s }
    .lb-row:nth-child(3)  { animation-delay: .11s }
    .lb-row:nth-child(4)  { animation-delay: .14s }
    .lb-row:nth-child(5)  { animation-delay: .17s }
    .lb-row:nth-child(6)  { animation-delay: .20s }
    .lb-row:nth-child(7)  { animation-delay: .23s }
    .lb-row:nth-child(8)  { animation-delay: .26s }
    .lb-row:nth-child(9)  { animation-delay: .29s }
    .lb-row:nth-child(10) { animation-delay: .32s }

    /* ── RANK BADGE ── */
    .lb-rank {
      flex: 0 0 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 900;
      font-family: 'Courier New', monospace;
      background: var(--lb-bg-rank);
      color: var(--lb-rank-color);
    }

    /* ── BODY ── */
    .lb-body {
      flex: 1;
      display: flex;
      align-items: center;
      padding: 10px 14px;
      background: var(--lb-bg);
      position: relative;
      overflow: hidden;
      gap: 10px;
    }

    /* Thanh xéo góc phải */
    .lb-body::after {
      content: '';
      position: absolute;
      right: 0; top: 0;
      width: 36%;
      height: 100%;
      background: linear-gradient(135deg,
        transparent 20px,
        var(--lb-accent) 20px);
      pointer-events: none;
    }

    .lb-avatar {
      width: 28px; height: 28px;
      border-radius: 50%;
      background: var(--lb-bg-rank);
      border: 1px solid var(--border);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px;
      flex-shrink: 0;
      color: var(--text-light);
    }

    .lb-name {
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 180px;
      letter-spacing: .2px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .lb-me-dot {
      width: 7px; height: 7px;
      background: #3b82f6;
      border-radius: 50%;
      flex-shrink: 0;
    }

    /* ── ELO ── */
    .lb-elo-col {
      flex: 0 0 68px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 900;
      font-family: 'Courier New', monospace;
      color: var(--lb-rank-color);
      background: var(--lb-bg);
      letter-spacing: .5px;
    }
    /* Hàng thường thì ELO màu gold */
    .lb-row:not(.rank-1):not(.rank-2):not(.rank-3):not(.lb-me) .lb-elo-col {
      color: var(--gold);
    }

    /* ── TOP 1 — gold ── */
    .lb-row.rank-1 {
      --lb-bg:        rgba(200,153,42,.08);
      --lb-bg-rank:   rgba(200,153,42,.18);
      --lb-accent:    rgba(200,153,42,.13);
      --lb-rank-color: var(--gold);
      box-shadow: 0 2px 18px rgba(200,153,42,.14);
    }
    .lb-row.rank-1 .lb-rank { font-size: 20px; }
    .lb-row.rank-1 .lb-name { font-weight: 800; }

    /* ── TOP 2 — silver ── */
    .lb-row.rank-2 {
      --lb-bg:        rgba(160,170,180,.07);
      --lb-bg-rank:   rgba(160,170,180,.15);
      --lb-accent:    rgba(160,170,180,.10);
      --lb-rank-color: var(--text-light);
      box-shadow: 0 2px 12px rgba(160,170,180,.08);
    }
    .lb-row.rank-2 .lb-rank { font-size: 20px; }

    /* ── TOP 3 — bronze ── */
    .lb-row.rank-3 {
      --lb-bg:        rgba(180,100,50,.07);
      --lb-bg-rank:   rgba(180,100,50,.16);
      --lb-accent:    rgba(180,100,50,.10);
      --lb-rank-color: #c87040;
      box-shadow: 0 2px 12px rgba(180,100,50,.08);
    }
    .lb-row.rank-3 .lb-rank { font-size: 20px; }

    /* ── ME (ngoài top 3) — blue ── */
    /* FIX: dùng --lb-bg trên row → lb-body và lb-elo-col tự inherit
       không cần override từng child nữa → không bị miss */
    .lb-row.lb-me {
      --lb-bg:        rgba(59,130,246,.09);
      --lb-bg-rank:   rgba(59,130,246,.18);
      --lb-accent:    rgba(59,130,246,.12);
      --lb-rank-color: #3b82f6;
      box-shadow: 0 2px 12px rgba(59,130,246,.1);
      border: 1px solid rgba(59,130,246,.2);
    }

    /* ── SKELETON ── */
    .lb-skel {
      height: 48px;
      border-radius: 9px;
      background: var(--bg3);
      position: relative;
      overflow: hidden;
    }
    .lb-skel::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg,
        transparent 25%,
        rgba(255,255,255,.06) 50%,
        transparent 75%);
      background-size: 200% 100%;
      animation: lb-shimmer 1.4s infinite;
    }
    @keyframes lb-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ── EMPTY ── */
    .lb-empty {
      text-align: center;
      color: var(--text-light);
      font-size: 13px;
      font-style: italic;
      padding: 30px 0;
    }

    /* ── MY RANK BAR ── */
    #myRankBar {
      margin-top: 10px;
      padding: 9px 14px;
      border-radius: 9px;
      background: rgba(59,130,246,.05);
      border: 1px dashed rgba(59,130,246,.2);
      font-size: 12px;
      color: var(--text-light);
      text-align: center;
      line-height: 1.6;
    }
    #myRankBar.hidden { display: none; }
  `;
  document.head.appendChild(style);
})();

// ─────────────────────────────────────────
//  INJECT HTML
// ─────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const menuWrap = document.querySelector("#screen-menu .menu-wrap");
  if (!menuWrap) return;

  const section = document.createElement("div");
  section.id = "leaderboardSection";
  section.innerHTML = `
    <div class="lb-header">
      <span class="lb-title">Bảng xếp hạng</span>
      <button class="lb-refresh" id="btnLbRefresh">↺ Làm mới</button>
    </div>
    <div id="lbList">
      ${Array(6).fill('<div class="lb-skel"></div>').join("")}
    </div>
    <div id="myRankBar" class="hidden"></div>
  `;
  menuWrap.appendChild(section);

  document.getElementById("btnLbRefresh").onclick = () => {
    const btn = document.getElementById("btnLbRefresh");
    btn.classList.add("spinning");
    setTimeout(() => btn.classList.remove("spinning"), 500);
    loadLeaderboard(true);
  };

  loadLeaderboard(false);
  window.addEventListener("authChanged", () => setTimeout(() => loadLeaderboard(false), 700));
});

// ─────────────────────────────────────────
//  LOAD DATA
// ─────────────────────────────────────────
async function loadLeaderboard(showToast = false) {
  const list = document.getElementById("lbList");
  const myRankBar = document.getElementById("myRankBar");
  if (!list) return;

  if (showToast) {
    list.innerHTML = Array(6).fill('<div class="lb-skel"></div>').join("");
    if (myRankBar) myRankBar.classList.add("hidden");
  }

  try {
    const res = await fetch(LB_API + "/leaderboard");
    if (!res.ok) throw new Error("Server error");
    const data = await res.json();
    renderLeaderboard(data);
    if (showToast && typeof toast === "function") toast("↺ Đã làm mới bảng xếp hạng");
  } catch (err) {
    if (list) list.innerHTML = `<p class="lb-empty">Không tải được bảng xếp hạng 😢</p>`;
    console.error("Leaderboard error:", err);
  }
}

// ─────────────────────────────────────────
//  RENDER
// ─────────────────────────────────────────
function renderLeaderboard(data) {
  const list = document.getElementById("lbList");
  const myRankBar = document.getElementById("myRankBar");
  if (!list) return;

  const authUser = window.getAuthUser ? window.getAuthUser() : null;

  if (!data.length) {
    list.innerHTML = `<p class="lb-empty">Chưa có dữ liệu xếp hạng</p>`;
    return;
  }

  const rankEmoji = { 1: "🥇", 2: "🥈", 3: "🥉" };

  list.innerHTML = data.map(p => {
    const isMe = authUser && authUser.username === p.username;
    const rankCls = p.rank <= 3 ? `rank-${p.rank}` : "";
    const meCls   = isMe && p.rank > 3 ? "lb-me" : "";
    const rankDisplay = rankEmoji[p.rank] || `#${p.rank}`;

    return `
      <div class="lb-row ${rankCls} ${meCls}">
        <div class="lb-rank">${rankDisplay}</div>
        <div class="lb-body">
          <div class="lb-avatar">👤</div>
          <div class="lb-name">
            ${escLb(p.username)}
            ${isMe ? '<span class="lb-me-dot"></span>' : ""}
          </div>
        </div>
        <div class="lb-elo-col">${p.elo}</div>
      </div>`;
  }).join("");

  if (myRankBar) {
    const inTop = authUser && data.some(p => p.username === authUser.username);
    if (authUser && !inTop) {
      myRankBar.classList.remove("hidden");
      myRankBar.innerHTML = `Bạn chưa có trong top 20 — hãy chơi thêm để leo rank! 🎯`;
    } else {
      myRankBar.classList.add("hidden");
    }
  }
}

// ─────────────────────────────────────────
//  ESCAPE HTML
// ─────────────────────────────────────────
function escLb(t) {
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}