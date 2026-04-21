// =============================================================================
//  FRIENDS-CLIENT.JS — Logic kết bạn phía client
// =============================================================================

const FRIENDS_API = window.location.origin;

// ─────────────────────────────────────────
//  API HELPER
// ─────────────────────────────────────────
async function friendsAPI(method, path, body) {
  const token = window.getAuthToken ? window.getAuthToken() : null;
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(FRIENDS_API + path, opts);
  const data = await res.json();
  return { ok: res.ok, data };
}

// ─────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────
let _friends = [];
let _pending = [];
let _pendingCount = 0;

// ─────────────────────────────────────────
//  MỞ / ĐÓNG PANEL KẾT BẠN
// ─────────────────────────────────────────
function openFriendsPanel() {
  const user = window.getAuthUser ? window.getAuthUser() : null;
  if (!user) {
    if (typeof authToast === "function") authToast("⚠ Bạn cần đăng nhập để dùng tính năng này");
    return;
  }
  const panel = document.getElementById("friendsPanel");
  if (!panel) return;
  panel.classList.remove("hidden");
  loadFriendsList();
  loadPendingRequests();
  showFriendsTab("tab-friends");
}

function closeFriendsPanel() {
  const panel = document.getElementById("friendsPanel");
  if (panel) panel.classList.add("hidden");
}

function showFriendsTab(tabId) {
  document.querySelectorAll(".fr-tab-content").forEach(t => t.classList.add("hidden"));
  document.querySelectorAll(".fr-tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById(tabId)?.classList.remove("hidden");
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add("active");
}

// ─────────────────────────────────────────
//  TÌM KIẾM NGƯỜI DÙNG THEO ID
// ─────────────────────────────────────────
async function searchUserById() {
  const input = document.getElementById("friendSearchInput");
  const raw = input?.value.trim().replace(/^#/, ""); // bỏ dấu # nếu có
  const id = parseInt(raw);

  const resultEl = document.getElementById("friendSearchResult");
  if (!raw || isNaN(id)) {
    resultEl.innerHTML = `<p class="fr-hint">⚠ Nhập ID hợp lệ (ví dụ: #12)</p>`;
    return;
  }

  resultEl.innerHTML = `<p class="fr-hint">🔍 Đang tìm kiếm...</p>`;

  const { ok, data } = await friendsAPI("GET", `/friends/search?id=${id}`);

  if (!ok) {
    resultEl.innerHTML = `<p class="fr-hint err">${data.message}</p>`;
    return;
  }

  const total = (data.stats?.wins || 0) + (data.stats?.losses || 0) + (data.stats?.draws || 0);
  const wr = total ? Math.round((data.stats.wins / total) * 100) : 0;

  let actionBtn = "";
  if (data.relationStatus === "friends") {
    actionBtn = `<button class="fr-btn fr-btn-danger" onclick="removeFriendDirect(${data.id})">🗑 Xóa bạn</button>`;
  } else if (data.relationStatus === "pending_sent") {
    actionBtn = `<button class="fr-btn" disabled>⏳ Đã gửi lời mời</button>`;
  } else if (data.relationStatus === "pending_received") {
    actionBtn = `
      <button class="fr-btn fr-btn-green" onclick="acceptFriend(${data.friendshipId})">✅ Chấp nhận</button>
      <button class="fr-btn fr-btn-danger" onclick="declineFriend(${data.friendshipId})">❌ Từ chối</button>`;
  } else {
    actionBtn = `<button class="fr-btn fr-btn-green" onclick="sendFriendRequest(${data.id})">➕ Kết bạn</button>`;
  }

  resultEl.innerHTML = `
    <div class="fr-user-card">
      <div class="fr-user-info">
        <div class="fr-user-name">👤 ${escFr(data.username)} <span class="fr-user-id">#${data.id}</span></div>
        <div class="fr-user-stats">
          ELO: <b>${data.stats?.elo ?? 1000}</b> &nbsp;·&nbsp;
          ${data.stats?.wins ?? 0}W / ${data.stats?.losses ?? 0}L / ${data.stats?.draws ?? 0}D
          &nbsp;·&nbsp; ${wr}% thắng
        </div>
      </div>
      <div class="fr-user-actions">${actionBtn}</div>
    </div>`;
}

// ─────────────────────────────────────────
//  GỬI LỜI MỜI KẾT BẠN
// ─────────────────────────────────────────
async function sendFriendRequest(receiverId) {
  const { ok, data } = await friendsAPI("POST", "/friends/request", { receiverId });
  if (typeof authToast === "function") authToast(ok ? "✅ Đã gửi lời mời kết bạn!" : "❌ " + data.message);
  if (ok) searchUserById(); // refresh kết quả tìm kiếm
}

// ─────────────────────────────────────────
//  CHẤP NHẬN LỜI MỜI
// ─────────────────────────────────────────
async function acceptFriend(friendshipId) {
  const { ok, data } = await friendsAPI("POST", "/friends/accept", { friendshipId });
  if (typeof authToast === "function") authToast(ok ? "🤝 Đã kết bạn!" : "❌ " + data.message);
  if (ok) { loadFriendsList(); loadPendingRequests(); searchUserById(); }
}

// ─────────────────────────────────────────
//  TỪ CHỐI / HỦY LỜI MỜI
// ─────────────────────────────────────────
async function declineFriend(friendshipId) {
  const { ok, data } = await friendsAPI("POST", "/friends/decline", { friendshipId });
  if (typeof authToast === "function") authToast(ok ? "Đã từ chối lời mời." : "❌ " + data.message);
  if (ok) { loadPendingRequests(); searchUserById(); }
}

// ─────────────────────────────────────────
//  XÓA BẠN BÈ
// ─────────────────────────────────────────
async function removeFriendDirect(friendId) {
  if (window.showConfirm) {
    window.showConfirm("Xóa người này khỏi danh sách bạn bè?", async () => {
      const { ok, data } = await friendsAPI("POST", "/friends/remove", { friendId });
      if (typeof authToast === "function") authToast(ok ? "Đã xóa bạn bè." : "❌ " + data.message);
      if (ok) { loadFriendsList(); searchUserById(); }
    });
  }
}

async function removeFriend(friendId) {
  removeFriendDirect(friendId);
}

// ─────────────────────────────────────────
//  TẢI DANH SÁCH BẠN BÈ
// ─────────────────────────────────────────
async function loadFriendsList() {
  const el = document.getElementById("friendsList");
  if (!el) return;
  el.innerHTML = `<p class="fr-hint">Đang tải...</p>`;

  const { ok, data } = await friendsAPI("GET", "/friends/list");
  if (!ok) { el.innerHTML = `<p class="fr-hint err">Không tải được danh sách</p>`; return; }

  _friends = data;
  if (!data.length) { el.innerHTML = `<p class="fr-hint">Chưa có bạn bè nào 😢<br>Tìm kiếm bạn bè theo ID ở tab Tìm kiếm!</p>`; return; }

  const currentRoomId = window.S?.roomId && !window.S?.bot ? window.S.roomId : null;

  el.innerHTML = data.map(f => `
    <div class="fr-friend-card" id="fr-${f.id}">
      <div class="fr-friend-info">
        <span class="fr-friend-name">👤 ${escFr(f.username)}</span>
        <span class="fr-friend-id">#${f.id}</span>
        <span class="fr-friend-elo">ELO ${f.elo}</span>
      </div>
      <div class="fr-friend-actions">
        ${currentRoomId
          ? `<button class="fr-btn fr-btn-gold" onclick="inviteToRoom(${f.id}, '${currentRoomId}')">📨 Mời vào phòng</button>`
          : ""}
        <button class="fr-btn fr-btn-danger" onclick="removeFriend(${f.id})">🗑</button>
      </div>
    </div>`).join("");
}

// ─────────────────────────────────────────
//  TẢI DANH SÁCH LỜI MỜI ĐANG CHỜ
// ─────────────────────────────────────────
async function loadPendingRequests() {
  const el = document.getElementById("pendingList");
  if (!el) return;
  el.innerHTML = `<p class="fr-hint">Đang tải...</p>`;

  const { ok, data } = await friendsAPI("GET", "/friends/pending");
  if (!ok) { el.innerHTML = `<p class="fr-hint err">Không tải được</p>`; return; }

  _pending = data;
  _pendingCount = data.length;
  updatePendingBadge();

  if (!data.length) { el.innerHTML = `<p class="fr-hint">Không có lời mời nào</p>`; return; }

  el.innerHTML = data.map(f => `
    <div class="fr-friend-card" id="pending-${f.friendshipId}">
      <div class="fr-friend-info">
        <span class="fr-friend-name">👤 ${escFr(f.from.username)}</span>
        <span class="fr-friend-id">#${f.from.id}</span>
      </div>
      <div class="fr-friend-actions">
        <button class="fr-btn fr-btn-green" onclick="acceptFriend(${f.friendshipId})">✅ Chấp nhận</button>
        <button class="fr-btn fr-btn-danger" onclick="declineFriend(${f.friendshipId})">❌ Từ chối</button>
      </div>
    </div>`).join("");
}

// ─────────────────────────────────────────
//  MỜI BẠN BÈ VÀO PHÒNG
// ─────────────────────────────────────────
async function inviteToRoom(friendId, roomId) {
  const { ok, data } = await friendsAPI("POST", "/friends/invite-room", { friendId, roomId });
  if (typeof authToast === "function") authToast(ok ? "📨 Đã gửi lời mời vào phòng!" : "❌ " + data.message);
}

// ─────────────────────────────────────────
//  CẬP NHẬT BADGE SỐ LỜI MỜI
// ─────────────────────────────────────────
function updatePendingBadge() {
  const badge = document.getElementById("friendsBadge");
  if (!badge) return;
  if (_pendingCount > 0) {
    badge.textContent = _pendingCount;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

// ─────────────────────────────────────────
//  ESCAPE HTML
// ─────────────────────────────────────────
function escFr(t) {
  return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ─────────────────────────────────────────
//  SOCKET EVENTS — Nhận thông báo realtime
// ─────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  if (typeof socket === "undefined") return;

  socket.on("friendRequest", ({ friendshipId, from }) => {
    _pendingCount++;
    updatePendingBadge();
    if (typeof authToast === "function") {
      authToast(`👋 ${from.username} muốn kết bạn với bạn!`, 4000);
    }
    if (!document.getElementById("friendsPanel")?.classList.contains("hidden")) {
      loadPendingRequests();
    }
  });

  socket.on("friendAccepted", ({ friendshipId, by }) => {
    if (typeof authToast === "function") {
      authToast(`🤝 ${by.username} đã chấp nhận lời mời kết bạn!`, 4000);
    }
    if (!document.getElementById("friendsPanel")?.classList.contains("hidden")) {
      loadFriendsList();
    }
  });

  socket.on("roomInvite", ({ roomId, from }) => {
    if (window.showConfirm) {
      window.showConfirm(
        `📨 <b>${from.username}</b> mời bạn vào phòng <b>${roomId}</b>. Vào không?`,
        () => {
          if (typeof joinRoom === "function") joinRoom(roomId);
          else if (typeof socket !== "undefined")
            socket.emit("joinRoom", { roomId, playerId: window.MY_ID, icon: window.myIcon, color: window.myColor });
        }
      );
    } else {
      if (typeof authToast === "function")
        authToast(`📨 ${from.username} mời bạn vào phòng ${roomId}`, 5000);
    }
  });

  window.addEventListener("authChanged", () => {
    const user = window.getAuthUser ? window.getAuthUser() : null;
    _friends = []; _pending = []; _pendingCount = 0;
    updatePendingBadge();
    if (user) {
      setTimeout(() => {
        loadPendingRequests();
        loadFriendsList();
      }, 800);
    }
  });
});

// ─────────────────────────────────────────
//  INJECT HTML PANEL + CSS VÀO TRANG
// ─────────────────────────────────────────
(function injectFriendsUI() {
  const style = document.createElement("style");
  style.textContent = `
    /* ── FRIENDS BUTTON ── */
    #btnFriends {
      position: fixed; bottom: 20px; right: 20px; z-index: 300;
      background: var(--gold, #c8992a); color: #111;
      border: none; border-radius: 50px;
      padding: 10px 18px; font-size: 14px; font-weight: 700;
      cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,.35);
      display: flex; align-items: center; gap: 7px;
      transition: transform .15s, box-shadow .15s;
    }
    #btnFriends:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,.45); }
    #friendsBadge {
      background: #ef4444; color: #fff;
      border-radius: 50%; width: 18px; height: 18px;
      font-size: 11px; display: flex; align-items: center; justify-content: center;
    }
    #friendsBadge.hidden { display: none; }

    /* ── PANEL ── */
    #friendsPanel {
      position: fixed; bottom: 70px; right: 20px; z-index: 400;
      width: 340px; max-height: 520px;
      background: var(--bg-card, #1a1a1a);
      border: 1px solid var(--border, #333);
      border-radius: 14px; box-shadow: 0 8px 32px rgba(0,0,0,.5);
      display: flex; flex-direction: column; overflow: hidden;
    }
    #friendsPanel.hidden { display: none; }

    .fr-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px 0;
    }
    .fr-header h3 { margin: 0; font-size: 15px; color: var(--gold, #c8992a); }
    .fr-close {
      background: none; border: none; color: var(--dim, #888);
      font-size: 18px; cursor: pointer; padding: 0 4px;
    }
    .fr-close:hover { color: #fff; }

    /* ── TABS ── */
    .fr-tabs {
      display: flex; gap: 4px; padding: 10px 12px 0;
      border-bottom: 1px solid var(--border, #333);
    }
    .fr-tab-btn {
      flex: 1; padding: 7px 4px; border: none; border-radius: 8px 8px 0 0;
      background: transparent; color: var(--dim, #888);
      font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s;
    }
    .fr-tab-btn.active { background: var(--bg-hover, #252525); color: var(--gold, #c8992a); }
    .fr-tab-btn:hover:not(.active) { color: #ccc; }

    /* ── TAB CONTENT ── */
    .fr-tab-content { padding: 12px; overflow-y: auto; flex: 1; }
    .fr-tab-content.hidden { display: none; }

    /* ── SEARCH ── */
    .fr-search-row {
      display: flex; gap: 7px; margin-bottom: 12px;
    }
    .fr-search-input {
      flex: 1; padding: 8px 11px; border-radius: 8px;
      border: 1px solid var(--border, #333);
      background: var(--bg-input, #111); color: var(--text, #eee);
      font-size: 13px;
    }
    .fr-search-input:focus { outline: none; border-color: var(--gold, #c8992a); }
    .fr-search-btn {
      padding: 8px 13px; border-radius: 8px;
      background: var(--gold, #c8992a); color: #111;
      border: none; font-weight: 700; cursor: pointer; font-size: 13px;
    }
    .fr-search-btn:hover { opacity: .85; }

    /* ── CARDS ── */
    .fr-user-card, .fr-friend-card {
      background: var(--bg-hover, #222); border-radius: 10px;
      padding: 11px 13px; margin-bottom: 8px;
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; flex-wrap: wrap;
    }
    .fr-user-name, .fr-friend-name { font-size: 14px; font-weight: 600; color: var(--text, #eee); }
    .fr-user-id, .fr-friend-id { font-size: 12px; color: var(--gold, #c8992a); margin-left: 5px; }
    .fr-user-stats { font-size: 12px; color: var(--dim, #888); margin-top: 4px; }
    .fr-friend-elo { font-size: 12px; color: var(--dim, #888); margin-left: 8px; }
    .fr-user-actions, .fr-friend-actions { display: flex; gap: 6px; flex-wrap: wrap; }

    /* ── BUTTONS ── */
    .fr-btn {
      padding: 6px 12px; border-radius: 7px; border: none;
      font-size: 12px; font-weight: 600; cursor: pointer;
      background: var(--bg-input, #333); color: var(--text, #eee);
      transition: opacity .15s;
    }
    .fr-btn:hover:not(:disabled) { opacity: .8; }
    .fr-btn:disabled { opacity: .45; cursor: not-allowed; }
    .fr-btn-green { background: #22c55e; color: #fff; }
    .fr-btn-danger { background: #ef4444; color: #fff; }
    .fr-btn-gold { background: var(--gold, #c8992a); color: #111; }

    /* ── HINTS ── */
    .fr-hint {
      text-align: center; color: var(--dim, #888);
      font-size: 13px; padding: 14px 0; line-height: 1.7;
    }
    .fr-hint.err { color: #ef4444; }
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.id = "btnFriends";
  btn.innerHTML = `👥 Bạn bè <span id="friendsBadge" class="hidden">0</span>`;
  btn.onclick = openFriendsPanel;
  document.body.appendChild(btn);

  // Panel
  const panel = document.createElement("div");
  panel.id = "friendsPanel";
  panel.className = "hidden";
  panel.innerHTML = `
    <div class="fr-header">
      <h3>👥 Bạn bè</h3>
      <button class="fr-close" onclick="closeFriendsPanel()">✕</button>
    </div>

    <div class="fr-tabs">
      <button class="fr-tab-btn active" data-tab="tab-friends"
        onclick="showFriendsTab('tab-friends')">Bạn bè</button>
      <button class="fr-tab-btn" data-tab="tab-pending"
        onclick="showFriendsTab('tab-pending')">Lời mời</button>
      <button class="fr-tab-btn" data-tab="tab-search"
        onclick="showFriendsTab('tab-search')">Tìm kiếm</button>
    </div>

    <!-- Tab: Danh sách bạn bè -->
    <div class="fr-tab-content" id="tab-friends">
      <div id="friendsList"><p class="fr-hint">Đang tải...</p></div>
    </div>

    <!-- Tab: Lời mời đang chờ -->
    <div class="fr-tab-content hidden" id="tab-pending">
      <div id="pendingList"><p class="fr-hint">Đang tải...</p></div>
    </div>

    <!-- Tab: Tìm kiếm -->
    <div class="fr-tab-content hidden" id="tab-search">
      <div class="fr-search-row">
        <input type="text" id="friendSearchInput" class="fr-search-input"
          placeholder="Nhập ID người chơi, ví dụ: #12"
          onkeydown="if(event.key==='Enter') searchUserById()" />
        <button class="fr-search-btn" onclick="searchUserById()">🔍</button>
      </div>
      <div id="friendSearchResult">
        <p class="fr-hint">Nhập ID người chơi để tìm kiếm<br>
        ID của bạn bè hiển thị trong profile của họ</p>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
})();