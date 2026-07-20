const tokenKey = "gmail-chat-token";

let token = localStorage.getItem(tokenKey) || "";
let currentUser = null;
let conversations = [];
let requests = [];
let friends = [];
let tasks = [];
let messages = [];
let conversationTasks = [];
let activeConversationId = "";
let authMode = "login";
let activeTab = "messages";
let searchText = "";
let searchResults = [];
let events = null;
let callState = null;
let incomingCall = null;
let modal = null;
let profileModal = null;

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function $(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function isGmail(email) {
  return /^[^\s@]+@gmail\.com$/i.test(email);
}

function initials(value) {
  return String(value || "")
    .split(/[ .@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function renderAvatar(entity, extraClass = "") {
  const avatarUrl = entity?.avatarUrl || "";
  const label = entity?.avatar || initials(entity?.name || entity?.email || "?") || "?";
  if (avatarUrl) {
    return `<div class="avatar ${extraClass}"><img src="${escapeAttr(avatarUrl)}" alt=""></div>`;
  }
  return `<div class="avatar ${extraClass}">${escapeHtml(label)}</div>`;
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Co loi xay ra.");
  return data;
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2800);
}

function applyTheme() {
  const theme = currentUser?.theme || localStorage.getItem("gmail-chat-theme") || "light";
  const resolved = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  document.body.dataset.theme = resolved;
}

async function boot() {
  if (!token) {
    renderAuth();
    return;
  }

  try {
    await refreshData();
    connectEvents();
    renderApp();
  } catch {
    token = "";
    localStorage.removeItem(tokenKey);
    renderAuth();
  }
}

async function refreshData({ keepMessages = false } = {}) {
  const data = await api("/api/me");
  currentUser = data.user;
  conversations = data.conversations || [];
  requests = data.requests || [];
  friends = data.friends || [];
  tasks = data.tasks || [];
  localStorage.setItem("gmail-chat-theme", currentUser.theme || "light");
  applyTheme();

  if (!conversations.some((item) => item.id === activeConversationId)) {
    activeConversationId = conversations[0]?.id || "";
  }

  if (activeConversationId && !keepMessages) await loadMessages(activeConversationId);
}

async function loadMessages(conversationId) {
  if (!conversationId) {
    messages = [];
    conversationTasks = [];
    return;
  }
  const data = await api(`/api/conversations/${conversationId}/messages`);
  messages = data.messages || [];
  conversationTasks = data.tasks || [];
}

function connectEvents() {
  if (events) events.close();
  events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  events.addEventListener("refresh", async () => {
    const previous = activeConversationId;
    await refreshData({ keepMessages: true });
    if (previous && conversations.some((item) => item.id === previous)) activeConversationId = previous;
    await loadMessages(activeConversationId);
    renderApp();
  });
  events.addEventListener("call-signal", (event) => {
    try {
      handleCallSignal(JSON.parse(event.data)).catch(() => showToast("Tin hieu cuoc goi bi loi."));
    } catch {
      showToast("Khong doc duoc tin hieu cuoc goi.");
    }
  });
}

function renderAuth() {
  applyTheme();
  $("#app").innerHTML = `
    <main class="auth-shell">
      <section class="auth-panel">
        <div class="brand">
          <div class="brand-mark">G</div>
          <div>
            <h1>Gmail Chat</h1>
            <p>Dang ky Gmail va chat truc tuyen</p>
          </div>
        </div>

        <div class="auth-tabs">
          <button type="button" class="${authMode === "login" ? "active" : ""}" data-auth-tab="login">Dang nhap</button>
          <button type="button" class="${authMode === "register" ? "active" : ""}" data-auth-tab="register">Dang ky</button>
        </div>

        <form id="authForm">
          <div class="field ${authMode === "register" ? "" : "hidden"}">
            <label for="name">Ten hien thi</label>
            <input id="name" name="name" autocomplete="name" placeholder="Nguyen Van A">
          </div>
          <div class="field">
            <label for="email">Gmail</label>
            <input id="email" name="email" type="email" autocomplete="email" placeholder="ban@gmail.com" required>
          </div>
          <div class="field">
            <label for="password">Mat khau</label>
            <input id="password" name="password" type="password" autocomplete="${authMode === "login" ? "current-password" : "new-password"}" placeholder="Toi thieu 6 ky tu" required>
          </div>
          <button class="primary-btn" type="submit">${authMode === "login" ? "Dang nhap" : "Tao tai khoan"}</button>
          <p class="error" id="authError"></p>
        </form>

        <p class="hint">
          Tai khoan thu: <strong>demo1@gmail.com</strong>, <strong>demo2@gmail.com</strong>,
          <strong>demo3@gmail.com</strong> / <strong>123456</strong>.
        </p>
      </section>

      <section class="preview" aria-hidden="true">
        <div class="phone-preview">
          <div class="phone-screen">
            <div class="preview-top">
              <strong>Chat, nhom, viec</strong>
              <span>Tim Gmail, ket ban, tao nhom, giao viec</span>
            </div>
            <div class="preview-list">
              ${["Tao nhom 3 nguoi", "Ghim tin quan trong", "Giao viec trong nhom", "Ho so va giao dien"]
                .map(
                  (item, index) => `
                    <div class="preview-row">
                      <div class="avatar ${index % 2 ? "orange" : "violet"}">${index + 1}</div>
                      <div>
                        <div class="preview-line"></div>
                        <div class="preview-line short"></div>
                      </div>
                    </div>
                  `
                )
                .join("")}
            </div>
          </div>
        </div>
      </section>
    </main>
  `;

  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      authMode = button.dataset.authTab;
      renderAuth();
    });
  });
  $("#authForm").addEventListener("submit", handleAuth);
}

async function handleAuth(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  const error = $("#authError");
  error.textContent = "";

  if (!isGmail(email)) return (error.textContent = "Vui long dung dia chi @gmail.com.");
  if (password.length < 6) return (error.textContent = "Mat khau can toi thieu 6 ky tu.");
  if (authMode === "register" && !name) return (error.textContent = "Vui long nhap ten hien thi.");

  try {
    const data = await api(authMode === "login" ? "/api/login" : "/api/register", {
      method: "POST",
      body: { name, email, password }
    });
    token = data.token;
    localStorage.setItem(tokenKey, token);
    await refreshData();
    connectEvents();
    renderApp();
  } catch (err) {
    error.textContent = err.message;
  }
}

function renderApp() {
  applyTheme();
  const active = getActiveConversation();
  $("#app").innerHTML = `
    <main class="app-shell">
      <nav class="rail" aria-label="Dieu huong">
        ${renderAvatar(currentUser)}
        <button class="icon-btn ${activeTab === "messages" ? "active" : ""}" data-rail-tab="messages" title="Tin nhan">C</button>
        <button class="icon-btn ${activeTab === "friends" ? "active" : ""}" data-rail-tab="friends" title="Ban be">F</button>
        <button class="icon-btn ${activeTab === "groups" ? "active" : ""}" data-rail-tab="groups" title="Nhom">G</button>
        <button class="icon-btn ${activeTab === "tasks" ? "active" : ""}" data-rail-tab="tasks" title="Cong viec">T</button>
        <div class="rail-spacer"></div>
        <button class="icon-btn" id="settingsBtn" title="Cai dat">S</button>
        <button class="icon-btn" id="logoutBtn" title="Dang xuat">X</button>
      </nav>

      <aside class="sidebar">
        <div class="search-zone">
          <label class="search-box">
            <span>@</span>
            <input id="searchInput" value="${escapeAttr(searchText)}" placeholder="Nhap Gmail, ban be, nhom">
          </label>
          <div class="quick-actions">
            <button class="small-btn" id="searchBtn">Tim Gmail</button>
            <button class="small-btn" id="newGroupBtn">Tao nhom</button>
          </div>
        </div>

        <div class="section-tabs wide">
          ${renderTab("messages", "Tin nhan")}
          ${renderTab("search", "Tim ban")}
          ${renderTab("friends", `Ban be ${friends.length}`)}
          ${renderTab("groups", "Nhom")}
          ${renderTab("tasks", "Viec")}
          ${renderTab("requests", `Loi moi ${requests.length ? `(${requests.length})` : ""}`)}
        </div>

        <div class="conversation-list">
          ${renderSidebarList()}
        </div>
      </aside>

      <section class="chat">
        ${active ? renderChat(active) : renderEmptyChat()}
      </section>

      <aside class="details">
        ${active ? renderDetails(active) : renderAccountDetails()}
      </aside>
    </main>
    ${renderCallLayer()}
    ${renderModalLayer()}
  `;

  bindAppEvents();
  attachCallStreams();
  scrollMessagesToBottom();
}

function renderTab(tab, label) {
  return `<button class="${activeTab === tab ? "active" : ""}" data-tab="${tab}">${escapeHtml(label)}</button>`;
}

function renderSidebarList() {
  if (activeTab === "search") return renderSearchResults();
  if (activeTab === "friends") return renderFriendsList();
  if (activeTab === "groups") return renderGroupsList();
  if (activeTab === "tasks") return renderTasksList(tasks, true);
  if (activeTab === "requests") return renderRequestsList();
  return renderConversationList();
}

function renderSearchResults() {
  if (!searchResults.length) {
    return `<div class="empty-state">Nhap Gmail roi bam Tim Gmail de gui loi moi ket ban.</div>`;
  }
  return searchResults
    .map(
      (user) => `
        <div class="contact-row padded">
          ${renderAvatar(user)}
          <div>
            <strong>${escapeHtml(user.name)}</strong>
            <p>${escapeHtml(user.email)}</p>
          </div>
          ${renderFriendAction(user)}
        </div>
      `
    )
    .join("");
}

function renderFriendsList() {
  if (!friends.length) return `<div class="empty-state">Ban chua co ban be. Hay tim Gmail de ket ban.</div>`;
  return friends
    .map(
      (friend) => `
        <div class="contact-row padded">
          ${renderAvatar(friend)}
          <div>
            <strong>${escapeHtml(friend.name)}</strong>
            <p>${escapeHtml(friend.email)}</p>
          </div>
          <div class="row-actions">
            <button class="mini-action ghost" data-profile="${escapeAttr(friend.id)}">Ho so</button>
            <button class="mini-action" data-open-conversation="${escapeAttr(friend.conversationId)}">Chat</button>
          </div>
        </div>
      `
    )
    .join("");
}

function renderGroupsList() {
  const groups = conversations.filter((item) => item.type === "group");
  if (!groups.length) return `<div class="empty-state">Chua co nhom. Can it nhat 3 nguoi da ket ban voi nhau de tao nhom.</div>`;
  return groups.map((item) => renderConversationButton(item)).join("");
}

function renderConversationList() {
  const query = searchText.trim().toLowerCase();
  const list = conversations.filter((item) => {
    const haystack = `${item.peer.name} ${item.peer.email} ${item.lastMessage?.text || ""}`.toLowerCase();
    return haystack.includes(query);
  });
  if (!list.length) return `<div class="empty-state">Chua co cuoc tro chuyen nao.</div>`;
  return list.map((item) => renderConversationButton(item)).join("");
}

function renderConversationButton(item) {
  const last = item.lastMessage;
  const openTasks = item.taskSummary?.open || 0;
  return `
    <button class="conversation ${item.id === activeConversationId ? "active" : ""}" data-conversation="${escapeAttr(item.id)}">
      ${renderAvatar(item.peer)}
      <div>
        <strong>${escapeHtml(item.peer.name)}</strong>
        <p>${escapeHtml(item.pinnedMessage ? `Ghim: ${item.pinnedMessage.text}` : last ? last.text : item.peer.email)}</p>
      </div>
      <div>
        <span class="time">${escapeHtml(formatTime(last?.createdAt))}</span>
        ${item.type === "group" ? `<span class="status-label slim">Nhom</span>` : ""}
        ${openTasks ? `<span class="badge">${openTasks}</span>` : ""}
      </div>
    </button>
  `;
}

function renderTasksList(list, showConversation) {
  if (!list.length) return `<div class="empty-state">Chua co cong viec nao.</div>`;
  return list
    .map(
      (task) => `
        <div class="task-row ${task.status === "done" ? "done" : ""}">
          <div>
            <strong>${escapeHtml(task.title)}</strong>
            <p>${escapeHtml(task.description || "Khong co mo ta")}</p>
            <span>${escapeHtml(task.assignee?.name || "Chua gan")} ${showConversation ? `- ${escapeHtml(task.conversationName || "")}` : ""}</span>
          </div>
          <button class="mini-action ${task.status === "done" ? "ghost" : ""}" data-task-toggle="${escapeAttr(task.id)}" data-next-status="${task.status === "done" ? "open" : "done"}">
            ${task.status === "done" ? "Mo lai" : "Xong"}
          </button>
        </div>
      `
    )
    .join("");
}

function renderRequestsList() {
  if (!requests.length) return `<div class="empty-state">Chua co loi moi ket ban nao.</div>`;
  return requests
    .map(
      (request) => `
        <div class="contact-row padded">
          ${renderAvatar(request.from, "orange")}
          <div>
            <strong>${escapeHtml(request.from.name)}</strong>
            <p>${escapeHtml(request.from.email)}</p>
          </div>
          <button class="mini-action" data-accept="${escapeAttr(request.id)}">Nhan</button>
        </div>
      `
    )
    .join("");
}

function renderFriendAction(user) {
  if (user.status === "friend") return `<span class="status-label">Ban be</span>`;
  if (user.status === "requested") return `<span class="status-label">Da gui</span>`;
  if (user.status === "incoming") return `<span class="status-label">Cho nhan</span>`;
  return `<button class="mini-action" data-add-friend="${escapeAttr(user.email)}">Ket ban</button>`;
}

function renderChat(active) {
  return `
    <header class="chat-header">
      <div class="person" data-profile="${active.type === "direct" ? escapeAttr(active.peer.id) : ""}">
        ${renderAvatar(active.peer)}
        <div>
          <strong>${escapeHtml(active.peer.name)}</strong>
          <span>${escapeHtml(active.type === "group" ? active.peer.email : `${active.peer.email} - dang san sang chat`)}</span>
        </div>
      </div>
      <div class="header-actions">
        <button title="${active.type === "group" ? "Goi nhom" : "Goi video"}" id="videoCallBtn">${active.type === "group" ? "Goi nhom" : "Video"}</button>
        <button title="Giao viec" id="newTaskBtn">Viec</button>
        <button title="Lam moi" id="headerRefreshBtn">R</button>
      </div>
    </header>

    ${active.pinnedMessage ? renderPinnedMessage(active.pinnedMessage) : ""}

    <div class="messages" id="messages">
      <div class="date-chip">Hom nay</div>
      ${messages.map((message) => renderMessage(message)).join("")}
    </div>

    <form class="composer" id="messageForm">
      <button class="tool-btn" type="button" id="emojiBtn" title="Bieu cam">:)</button>
      <textarea id="messageInput" rows="1" placeholder="Nhap tin nhan..."></textarea>
      <button class="send-btn" title="Gui" type="submit">Send</button>
    </form>
  `;
}

function renderPinnedMessage(message) {
  return `
    <div class="pinned-bar">
      <strong>Da ghim</strong>
      <span>${escapeHtml(message.text)}</span>
      <button class="mini-action ghost" id="unpinBtn">Bo ghim</button>
    </div>
  `;
}

function renderMessage(message) {
  const isMe = message.senderId === currentUser.id;
  return `
    <div class="message ${isMe ? "me" : ""} ${message.type === "system" || message.type === "task" ? "system-message" : ""}">
      ${renderAvatar(message.sender || { avatar: "?" })}
      <div class="bubble">
        <p>${escapeHtml(message.text)}</p>
        <time>${escapeHtml(formatTime(message.createdAt))}</time>
        <button class="pin-message-btn" data-pin-message="${escapeAttr(message.id)}">${message.isPinned ? "Dang ghim" : "Ghim"}</button>
      </div>
    </div>
  `;
}

function renderDetails(active) {
  if (active.type === "group") {
    return `
      <div class="details-cover"></div>
      <div class="details-profile">
        ${renderAvatar(active.peer)}
        <h2>${escapeHtml(active.peer.name)}</h2>
        <p>${escapeHtml(active.peer.email)}</p>
      </div>
      <div class="detail-block">
        <h3>Thanh vien</h3>
        ${(active.members || [])
          .map(
            (member) => `
              <div class="contact-row">
                ${renderAvatar(member)}
                <div>
                  <strong>${escapeHtml(member.name)}</strong>
                  <p>${escapeHtml(member.email)}</p>
                </div>
                <button class="mini-action ghost" data-profile="${escapeAttr(member.id)}">Ho so</button>
              </div>
            `
          )
          .join("")}
      </div>
      <div class="detail-block">
        <h3>Cong viec trong nhom</h3>
        ${renderTasksList(conversationTasks, false)}
      </div>
    `;
  }

  return `
    <div class="details-cover"></div>
    <div class="details-profile">
      ${renderAvatar(active.peer)}
      <h2>${escapeHtml(active.peer.name)}</h2>
      <p>${escapeHtml(active.peer.email)}</p>
    </div>
    <div class="detail-block">
      <button class="muted-btn" data-profile="${escapeAttr(active.peer.id)}">Xem ho so</button>
    </div>
    <div class="detail-block">
      <button class="muted-btn danger-text" data-unfriend="${escapeAttr(active.peer.id)}">Xoa ket ban</button>
    </div>
    <div class="detail-block">
      <h3>Cong viec lien quan</h3>
      ${renderTasksList(conversationTasks, false)}
    </div>
  `;
}

function renderAccountDetails() {
  return `
    <div class="details-cover"></div>
    <div class="details-profile">
      ${renderAvatar(currentUser)}
      <h2>${escapeHtml(currentUser.name)}</h2>
      <p>${escapeHtml(currentUser.email)}</p>
    </div>
    <div class="detail-block">
      <h3>Thong ke</h3>
      <p class="detail-copy">${friends.length} ban be - ${conversations.filter((item) => item.type === "group").length} nhom</p>
    </div>
  `;
}

function renderEmptyChat() {
  return `
    <div class="empty-chat">
      <h2>Bat dau bang Gmail</h2>
      <p>Ket ban, tao nhom 3 nguoi, giao viec, ghim tin nhan va goi video.</p>
    </div>
  `;
}

function renderModalLayer() {
  if (profileModal) return renderProfileModal(profileModal);
  if (modal === "group") return renderGroupModal();
  if (modal === "task") return renderTaskModal();
  if (modal === "settings") return renderSettingsModal();
  return "";
}

function renderGroupModal() {
  return `
    <div class="modal-layer">
      <form class="modal-panel" id="groupForm">
        <header>
          <h2>Tao nhom moi</h2>
          <button type="button" class="modal-close" data-close-modal>x</button>
        </header>
        <div class="field">
          <label>Ten nhom</label>
          <input name="name" placeholder="Vi du: Nhom du an">
        </div>
        <div class="member-picker">
          <p>Chon it nhat 2 ban be. Tat ca thanh vien can da ket ban voi nhau.</p>
          ${friends
            .map(
              (friend) => `
                <label class="check-row">
                  <input type="checkbox" name="memberIds" value="${escapeAttr(friend.id)}">
                  ${renderAvatar(friend)}
                  <span>${escapeHtml(friend.name)}<small>${escapeHtml(friend.email)}</small></span>
                </label>
              `
            )
            .join("")}
        </div>
        <button class="primary-btn" type="submit">Tao nhom</button>
      </form>
    </div>
  `;
}

function renderTaskModal() {
  const active = getActiveConversation();
  const members = active?.members || [];
  return `
    <div class="modal-layer">
      <form class="modal-panel" id="taskForm">
        <header>
          <h2>Giao viec</h2>
          <button type="button" class="modal-close" data-close-modal>x</button>
        </header>
        <div class="field">
          <label>Ten viec</label>
          <input name="title" placeholder="Nhap viec can lam">
        </div>
        <div class="field">
          <label>Giao cho</label>
          <select name="assigneeId">
            ${members.map((member) => `<option value="${escapeAttr(member.id)}">${escapeHtml(member.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Mo ta</label>
          <textarea name="description" rows="3" placeholder="Noi dung, deadline, ghi chu..."></textarea>
        </div>
        <button class="primary-btn" type="submit">Giao viec</button>
      </form>
    </div>
  `;
}

function renderSettingsModal() {
  return `
    <div class="modal-layer">
      <form class="modal-panel" id="settingsForm">
        <header>
          <h2>Cai dat tai khoan</h2>
          <button type="button" class="modal-close" data-close-modal>x</button>
        </header>
        <div class="profile-preview">
          ${renderAvatar(currentUser)}
          <div>
            <strong>${escapeHtml(currentUser.name)}</strong>
            <p>${escapeHtml(currentUser.email)} - ${friends.length} ban be</p>
          </div>
        </div>
        <div class="field">
          <label>Ten hien thi</label>
          <input name="name" value="${escapeAttr(currentUser.name)}">
        </div>
        <div class="field">
          <label>Anh dai dien URL</label>
          <input name="avatarUrl" value="${escapeAttr(currentUser.avatarUrl || "")}" placeholder="https://...">
        </div>
        <div class="field">
          <label>Gioi thieu</label>
          <textarea name="about" rows="3">${escapeHtml(currentUser.about || "")}</textarea>
        </div>
        <div class="field">
          <label>Giao dien</label>
          <select name="theme">
            ${["light", "dark", "system"].map((theme) => `<option value="${theme}" ${currentUser.theme === theme ? "selected" : ""}>${theme}</option>`).join("")}
          </select>
        </div>
        <button class="primary-btn" type="submit">Luu cai dat</button>
      </form>
    </div>
  `;
}

function renderProfileModal(profile) {
  return `
    <div class="modal-layer">
      <section class="modal-panel profile-card">
        <header>
          <h2>Ho so</h2>
          <button type="button" class="modal-close" data-close-profile>x</button>
        </header>
        <div class="profile-hero">
          ${renderAvatar(profile)}
          <h3>${escapeHtml(profile.name)}</h3>
          <p>${escapeHtml(profile.email)}</p>
        </div>
        <div class="profile-facts">
          <span>${profile.friendCount || 0} ban be</span>
          <span>${profile.groupsInCommon || 0} nhom chung</span>
          <span>${escapeHtml(profile.friendStatus || "")}</span>
        </div>
        <p class="detail-copy">${escapeHtml(profile.about || "Chua co gioi thieu.")}</p>
        ${profile.friendStatus === "friend" ? `<button class="muted-btn danger-text" data-unfriend="${escapeAttr(profile.id)}">Xoa ket ban</button>` : ""}
      </section>
    </div>
  `;
}

function getCallPeers() {
  if (!callState?.peers) return [];
  return Object.values(callState.peers);
}

function renderRemoteFrame(peer, index) {
  const user = peer.user || {};
  return `
    <div class="video-frame remote">
      <video data-remote-video="${escapeAttr(user.id || index)}" autoplay playsinline></video>
      <div class="video-placeholder ${peer.remoteStream ? "hidden" : ""}">
        <div class="call-avatar">${escapeHtml(user.avatar || "?")}</div>
        <p>${escapeHtml(peer.status || `Dang cho video cua ${user.name || "thanh vien"}...`)}</p>
      </div>
      <span class="video-name">${escapeHtml(user.name || "Thanh vien")}</span>
    </div>
  `;
}

function renderCallLayer() {
  if (incomingCall) {
    return `
      <div class="call-layer">
        <section class="call-panel compact">
          <div class="call-avatar">${escapeHtml(incomingCall.from.avatar)}</div>
          <h2>${incomingCall.isGroup ? "Cuoc goi nhom den" : "Cuoc goi video den"}</h2>
          <p>${escapeHtml(incomingCall.from.name)} dang goi ${incomingCall.isGroup ? `trong ${incomingCall.conversationName}` : "cho ban"}.</p>
          <div class="call-actions">
            <button class="call-btn danger" id="rejectCallBtn">Tu choi</button>
            <button class="call-btn accept" id="acceptCallBtn">Nhan</button>
          </div>
        </section>
      </div>
    `;
  }
  if (!callState) return "";
  const peers = getCallPeers();

  return `
    <div class="call-layer">
      <section class="call-panel">
        <header class="call-topbar">
          <div>
            <strong>${escapeHtml(callState.title || "Cuoc goi video")}</strong>
            <span>${escapeHtml(callState.status || "Dang ket noi...")}</span>
          </div>
          <button class="call-icon-btn" id="minimizeCallBtn" title="Thu nho">-</button>
        </header>
        <div class="video-grid ${peers.length > 1 ? "multi" : ""}">
          <div class="remote-video-grid">
            ${peers.length ? peers.map(renderRemoteFrame).join("") : `
              <div class="video-frame remote">
                <div class="video-placeholder">
                  <div class="call-avatar">?</div>
                  <p>Dang cho thanh vien tham gia...</p>
                </div>
              </div>
            `}
          </div>
          <div class="video-frame local">
            <video id="localVideo" autoplay playsinline muted></video>
            <span>Ban</span>
          </div>
        </div>
        <div class="call-actions">
          <button class="call-btn" id="toggleMicBtn">${callState.micEnabled ? "Tat mic" : "Bat mic"}</button>
          <button class="call-btn" id="toggleCameraBtn">${callState.cameraEnabled ? "Tat camera" : "Bat camera"}</button>
          <button class="call-btn danger" id="endCallBtn">Ket thuc</button>
        </div>
      </section>
    </div>
  `;
}

function bindAppEvents() {
  document.querySelectorAll("[data-tab], [data-rail-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.tab || button.dataset.railTab;
      renderApp();
    });
  });

  document.querySelectorAll("[data-conversation], [data-open-conversation]").forEach((button) => {
    button.addEventListener("click", async () => {
      activeConversationId = button.dataset.conversation || button.dataset.openConversation;
      activeTab = "messages";
      await loadMessages(activeConversationId);
      renderApp();
    });
  });

  document.querySelectorAll("[data-add-friend]").forEach((button) => {
    button.addEventListener("click", () => sendFriendRequest(button.dataset.addFriend));
  });
  document.querySelectorAll("[data-accept]").forEach((button) => {
    button.addEventListener("click", () => acceptFriendRequest(button.dataset.accept));
  });
  document.querySelectorAll("[data-profile]").forEach((button) => {
    button.addEventListener("click", () => openProfile(button.dataset.profile));
  });
  document.querySelectorAll("[data-unfriend]").forEach((button) => {
    button.addEventListener("click", () => unfriend(button.dataset.unfriend));
  });
  document.querySelectorAll("[data-pin-message]").forEach((button) => {
    button.addEventListener("click", () => pinMessage(button.dataset.pinMessage));
  });
  document.querySelectorAll("[data-task-toggle]").forEach((button) => {
    button.addEventListener("click", () => updateTaskStatus(button.dataset.taskToggle, button.dataset.nextStatus));
  });

  $("#searchInput")?.addEventListener("input", (event) => {
    searchText = event.target.value;
    if (activeTab === "messages") {
      renderApp();
      const input = $("#searchInput");
      input.focus();
      input.setSelectionRange(searchText.length, searchText.length);
    }
  });
  $("#searchInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchUsers();
  });

  $("#searchBtn")?.addEventListener("click", searchUsers);
  $("#newGroupBtn")?.addEventListener("click", () => {
    modal = "group";
    renderApp();
  });
  $("#newTaskBtn")?.addEventListener("click", () => {
    modal = "task";
    renderApp();
  });
  $("#settingsBtn")?.addEventListener("click", () => {
    modal = "settings";
    renderApp();
  });
  $("#refreshBtn")?.addEventListener("click", manualRefresh);
  $("#headerRefreshBtn")?.addEventListener("click", manualRefresh);
  $("#unpinBtn")?.addEventListener("click", unpinMessage);
  $("#videoCallBtn")?.addEventListener("click", startVideoCall);
  $("#acceptCallBtn")?.addEventListener("click", acceptIncomingCall);
  $("#rejectCallBtn")?.addEventListener("click", rejectIncomingCall);
  $("#endCallBtn")?.addEventListener("click", () => endCall(true));
  $("#toggleMicBtn")?.addEventListener("click", toggleMic);
  $("#toggleCameraBtn")?.addEventListener("click", toggleCamera);
  $("#minimizeCallBtn")?.addEventListener("click", () => showToast("Cuoc goi dang hien tren man hinh."));
  $("#logoutBtn")?.addEventListener("click", logout);
  $("#messageForm")?.addEventListener("submit", sendMessage);
  $("#groupForm")?.addEventListener("submit", createGroup);
  $("#taskForm")?.addEventListener("submit", createTask);
  $("#settingsForm")?.addEventListener("submit", saveSettings);
  $("#emojiBtn")?.addEventListener("click", () => {
    const input = $("#messageInput");
    input.value = `${input.value} :)`.trimStart();
    input.focus();
  });
  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => {
      modal = null;
      renderApp();
    });
  });
  document.querySelectorAll("[data-close-profile]").forEach((button) => {
    button.addEventListener("click", () => {
      profileModal = null;
      renderApp();
    });
  });
}

async function searchUsers() {
  const email = searchText.trim().toLowerCase();
  if (!email) return showToast("Nhap Gmail can tim.");
  activeTab = "search";
  try {
    const data = await api(`/api/search?email=${encodeURIComponent(email)}`);
    searchResults = data.users || [];
    if (!searchResults.length) showToast("Khong tim thay tai khoan phu hop.");
    renderApp();
  } catch (err) {
    showToast(err.message);
  }
}

async function sendFriendRequest(email) {
  try {
    await api("/api/friend-requests", { method: "POST", body: { email } });
    showToast("Da gui loi moi ket ban.");
    await searchUsers();
    await refreshData({ keepMessages: true });
    renderApp();
  } catch (err) {
    showToast(err.message);
  }
}

async function acceptFriendRequest(requestId) {
  try {
    const data = await api(`/api/friend-requests/${requestId}/accept`, { method: "POST" });
    activeConversationId = data.conversation.id;
    activeTab = "messages";
    await refreshData();
    renderApp();
    showToast("Da chap nhan ket ban.");
  } catch (err) {
    showToast(err.message);
  }
}

async function createGroup(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const memberIds = form.getAll("memberIds");
  try {
    const data = await api("/api/groups", {
      method: "POST",
      body: { name: form.get("name"), memberIds }
    });
    modal = null;
    activeConversationId = data.conversation.id;
    activeTab = "messages";
    await refreshData();
    renderApp();
    showToast("Da tao nhom.");
  } catch (err) {
    showToast(err.message);
  }
}

async function createTask(event) {
  event.preventDefault();
  const active = getActiveConversation();
  if (!active) return;
  const form = new FormData(event.currentTarget);
  try {
    await api(`/api/conversations/${active.id}/tasks`, {
      method: "POST",
      body: {
        title: form.get("title"),
        assigneeId: form.get("assigneeId"),
        description: form.get("description")
      }
    });
    modal = null;
    await refreshData();
    renderApp();
    showToast("Da giao viec.");
  } catch (err) {
    showToast(err.message);
  }
}

async function updateTaskStatus(taskId, status) {
  try {
    await api(`/api/tasks/${taskId}`, { method: "PATCH", body: { status } });
    await refreshData();
    renderApp();
  } catch (err) {
    showToast(err.message);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/me", {
      method: "PATCH",
      body: {
        name: form.get("name"),
        avatarUrl: form.get("avatarUrl"),
        about: form.get("about"),
        theme: form.get("theme")
      }
    });
    currentUser = data.user;
    localStorage.setItem("gmail-chat-theme", currentUser.theme || "light");
    modal = null;
    await refreshData({ keepMessages: true });
    renderApp();
    showToast("Da luu cai dat.");
  } catch (err) {
    showToast(err.message);
  }
}

async function openProfile(userId) {
  if (!userId) return;
  try {
    const data = await api(`/api/users/${userId}/profile`);
    profileModal = data.profile;
    renderApp();
  } catch (err) {
    showToast(err.message);
  }
}

async function unfriend(userId) {
  if (!userId) return;
  if (!window.confirm("Xoa ket ban voi tai khoan nay?")) return;
  try {
    await api(`/api/friends/${userId}`, { method: "DELETE" });
    profileModal = null;
    await refreshData();
    renderApp();
    showToast("Da xoa ket ban.");
  } catch (err) {
    showToast(err.message);
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const input = $("#messageInput");
  const text = input.value.trim();
  if (!text || !activeConversationId) return;
  input.value = "";
  try {
    await api(`/api/conversations/${activeConversationId}/messages`, { method: "POST", body: { text } });
    await refreshData();
    renderApp();
  } catch (err) {
    input.value = text;
    showToast(err.message);
  }
}

async function pinMessage(messageId) {
  if (!activeConversationId || !messageId) return;
  try {
    await api(`/api/conversations/${activeConversationId}/pin`, { method: "POST", body: { messageId } });
    await refreshData();
    renderApp();
    showToast("Da ghim tin nhan.");
  } catch (err) {
    showToast(err.message);
  }
}

async function unpinMessage() {
  if (!activeConversationId) return;
  try {
    await api(`/api/conversations/${activeConversationId}/pin`, { method: "DELETE" });
    await refreshData();
    renderApp();
    showToast("Da bo ghim.");
  } catch (err) {
    showToast(err.message);
  }
}

async function manualRefresh() {
  try {
    await refreshData();
    renderApp();
    showToast("Da cap nhat.");
  } catch (err) {
    showToast(err.message);
  }
}

function getActiveConversation() {
  return conversations.find((item) => item.id === activeConversationId) || null;
}

function makeCallId() {
  return `call_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function sendCallSignal(
  conversationId,
  type,
  payload = {},
  callId = callState?.callId || incomingCall?.callId,
  targetUserId = ""
) {
  if (!conversationId || !callId) return;
  await api("/api/calls/signal", { method: "POST", body: { conversationId, callId, type, payload, targetUserId } });
}

function createPeerConnection(conversationId, callId, remoteUser) {
  const peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnection.onicecandidate = (event) => {
    if (!event.candidate) return;
    sendCallSignal(conversationId, "candidate", { candidate: event.candidate }, callId, remoteUser.id).catch(() => {
      showToast("Khong gui duoc tin hieu ket noi video.");
    });
  };
  peerConnection.ontrack = (event) => {
    const peer = callState?.callId === callId ? callState.peers?.[remoteUser.id] : null;
    if (!peer) return;
    peer.remoteStream = event.streams[0] || peer.remoteStream || new MediaStream();
    if (!event.streams[0] && event.track) peer.remoteStream.addTrack(event.track);
    peer.status = "Dang trong cuoc goi";
    callState.status = "Dang trong cuoc goi";
    renderApp();
  };
  peerConnection.onconnectionstatechange = () => {
    const peer = callState?.callId === callId ? callState.peers?.[remoteUser.id] : null;
    if (!peer) return;
    if (peerConnection.connectionState === "connected") {
      peer.status = "Dang trong cuoc goi";
      callState.status = "Dang trong cuoc goi";
    }
    if (["failed", "disconnected"].includes(peerConnection.connectionState)) {
      peer.status = "Ket noi dang yeu";
      callState.status = "Mot so ket noi dang yeu";
    }
    renderApp();
  };
  return peerConnection;
}

function createCallPeer(remoteUser) {
  if (!callState || !remoteUser?.id) return null;
  const existing = callState.peers[remoteUser.id];
  if (existing) return existing;

  const peerConnection = createPeerConnection(callState.conversationId, callState.callId, remoteUser);
  const peer = {
    user: remoteUser,
    peerConnection,
    remoteStream: null,
    pendingCandidates: [],
    status: "Dang ket noi...",
    offerSent: false
  };
  callState.peers[remoteUser.id] = peer;
  callState.localStream.getTracks().forEach((track) => peerConnection.addTrack(track, callState.localStream));
  return peer;
}

async function sendOfferToUser(remoteUser) {
  if (!callState || !remoteUser?.id || remoteUser.id === currentUser.id) return;
  const peer = createCallPeer(remoteUser);
  if (!peer || peer.offerSent) return;
  peer.offerSent = true;
  const offer = await peer.peerConnection.createOffer();
  await peer.peerConnection.setLocalDescription(offer);
  await sendCallSignal(
    callState.conversationId,
    "offer",
    { description: peer.peerConnection.localDescription },
    callState.callId,
    remoteUser.id
  );
}

async function startVideoCall() {
  const active = getActiveConversation();
  if (!active) return showToast("Hay chon mot cuoc tro chuyen de goi.");
  if (callState || incomingCall) return showToast("Dang co mot cuoc goi khac.");
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    return showToast("Trinh duyet nay chua ho tro video call.");
  }

  const remoteMembers = (active.members || []).filter((member) => member.id !== currentUser.id);
  if (!remoteMembers.length) return showToast("Cuoc tro chuyen nay chua co nguoi khac de goi.");

  const callId = makeCallId();
  let localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    callState = {
      callId,
      conversationId: active.id,
      conversationType: active.type,
      hostId: currentUser.id,
      title: active.type === "group" ? active.peer.name : remoteMembers[0]?.name || active.peer.name,
      peer: active.peer,
      localStream,
      peers: {},
      status: active.type === "group" ? "Dang goi nhom..." : "Dang goi...",
      micEnabled: true,
      cameraEnabled: true
    };
    renderApp();
    for (const member of remoteMembers) {
      await sendOfferToUser(member);
    }
  } catch (err) {
    localStream?.getTracks().forEach((track) => track.stop());
    cleanupCall();
    showToast(err.name === "NotAllowedError" ? "Ban can cho phep camera va micro." : "Khong bat dau duoc cuoc goi video.");
  }
}

async function handleCallSignal(signal) {
  if (!signal?.type || !signal.callId) return;
  if (signal.from?.id === currentUser?.id) return;

  if (signal.type === "offer") {
    if (callState && callState.callId === signal.callId) {
      await answerOfferSignal(signal);
      return;
    }
    if (callState || (incomingCall && incomingCall.callId !== signal.callId)) {
      await sendCallSignal(signal.conversationId, "busy", {}, signal.callId, signal.from.id).catch(() => {});
      return;
    }

    const conversation = conversations.find((item) => item.id === signal.conversationId);
    if (!incomingCall) {
      incomingCall = {
        callId: signal.callId,
        conversationId: signal.conversationId,
        conversationName: conversation?.peer?.name || "cuoc tro chuyen",
        isGroup: conversation?.type === "group",
        from: signal.from,
        offers: {},
        pendingCandidates: {}
      };
    }
    incomingCall.offers[signal.from.id] = signal.payload.description;
    incomingCall.from = incomingCall.from || signal.from;
    renderApp();
    return;
  }

  if (incomingCall && incomingCall.callId === signal.callId && signal.type === "candidate") {
    const senderId = signal.from?.id || "";
    if (!incomingCall.pendingCandidates[senderId]) incomingCall.pendingCandidates[senderId] = [];
    incomingCall.pendingCandidates[senderId].push(signal.payload.candidate);
    return;
  }
  if (!callState || callState.callId !== signal.callId) return;

  if (signal.type === "answer") {
    const peer = callState.peers?.[signal.from?.id];
    if (!peer) return;
    await peer.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
    await flushPendingCandidates(peer);
    peer.status = "Dang trong cuoc goi";
    callState.status = "Dang trong cuoc goi";
    renderApp();
    return;
  }
  if (signal.type === "candidate") {
    await addCandidateToPeer(signal.from, signal.payload.candidate);
    return;
  }
  if (signal.type === "join") {
    if (callState.conversationType !== "group" || !signal.from?.id) return;
    const shouldOffer = currentUser.id === callState.hostId || currentUser.id < signal.from.id;
    if (shouldOffer && !callState.peers[signal.from.id]) await sendOfferToUser(signal.from);
    return;
  }
  if (signal.type === "reject") {
    removeCallPeer(signal.from?.id);
    showToast(`${signal.from?.name || "Mot thanh vien"} da tu choi cuoc goi.`);
    if (!getCallPeers().length) cleanupCall();
    renderApp();
    return;
  }
  if (signal.type === "busy") {
    removeCallPeer(signal.from?.id);
    showToast(`${signal.from?.name || "Doi phuong"} dang ban.`);
    if (!getCallPeers().length) cleanupCall();
    renderApp();
    return;
  }
  if (signal.type === "hangup") {
    removeCallPeer(signal.from?.id);
    showToast(`${signal.from?.name || "Mot thanh vien"} da roi cuoc goi.`);
    if (!getCallPeers().length || callState.conversationType !== "group") cleanupCall();
    renderApp();
  }
}

async function answerOfferSignal(signal) {
  if (!callState || !signal.from?.id) return;
  const peer = createCallPeer(signal.from);
  if (!peer) return;
  await peer.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
  await flushPendingCandidates(peer);
  const answer = await peer.peerConnection.createAnswer();
  await peer.peerConnection.setLocalDescription(answer);
  await sendCallSignal(
    callState.conversationId,
    "answer",
    { description: peer.peerConnection.localDescription },
    callState.callId,
    signal.from.id
  );
}

async function acceptIncomingCall() {
  const pending = incomingCall;
  if (!pending) return;
  incomingCall = null;
  const active = conversations.find((item) => item.id === pending.conversationId);

  let localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    callState = {
      callId: pending.callId,
      conversationId: pending.conversationId,
      conversationType: pending.isGroup ? "group" : "direct",
      hostId: pending.from.id,
      title: pending.isGroup ? pending.conversationName : pending.from.name,
      peer: pending.from,
      localStream,
      peers: {},
      status: "Dang ket noi...",
      micEnabled: true,
      cameraEnabled: true
    };
    renderApp();
    const offers = Object.entries(pending.offers || {});
    for (const [senderId, description] of offers) {
      const remoteUser = senderId === pending.from.id ? pending.from : active?.members?.find((member) => member.id === senderId);
      if (!remoteUser) continue;
      const peer = createCallPeer(remoteUser);
      peer.pendingCandidates = pending.pendingCandidates?.[senderId] || [];
      await peer.peerConnection.setRemoteDescription(new RTCSessionDescription(description));
      await flushPendingCandidates(peer);
      const answer = await peer.peerConnection.createAnswer();
      await peer.peerConnection.setLocalDescription(answer);
      await sendCallSignal(
        pending.conversationId,
        "answer",
        { description: peer.peerConnection.localDescription },
        pending.callId,
        senderId
      );
    }
    if (pending.isGroup) {
      await sendCallSignal(pending.conversationId, "join", {}, pending.callId).catch(() => {});
    }
  } catch (err) {
    localStream?.getTracks().forEach((track) => track.stop());
    const targets = Object.keys(pending.offers || {});
    for (const targetId of targets) {
      await sendCallSignal(pending.conversationId, "reject", {}, pending.callId, targetId).catch(() => {});
    }
    cleanupCall();
    renderApp();
    showToast(err.name === "NotAllowedError" ? "Ban can cho phep camera va micro." : "Khong nhan duoc cuoc goi.");
  }
}

async function rejectIncomingCall() {
  const pending = incomingCall;
  incomingCall = null;
  if (pending) {
    const targets = Object.keys(pending.offers || {});
    for (const targetId of targets) {
      await sendCallSignal(pending.conversationId, "reject", {}, pending.callId, targetId).catch(() => {});
    }
  }
  renderApp();
}

async function flushPendingCandidates(peer) {
  if (!peer?.pendingCandidates?.length) return;
  const candidates = [...peer.pendingCandidates];
  peer.pendingCandidates = [];
  for (const candidate of candidates) {
    if (candidate) await peer.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

async function addCandidateToPeer(remoteUser, candidate) {
  if (!remoteUser?.id || !candidate || !callState) return;
  const peer = callState.peers[remoteUser.id] || createCallPeer(remoteUser);
  if (!peer) return;
  if (peer.peerConnection.remoteDescription?.type) {
    await peer.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } else {
    peer.pendingCandidates.push(candidate);
  }
}

function toggleMic() {
  if (!callState?.localStream) return;
  callState.micEnabled = !callState.micEnabled;
  callState.localStream.getAudioTracks().forEach((track) => (track.enabled = callState.micEnabled));
  renderApp();
}

function toggleCamera() {
  if (!callState?.localStream) return;
  callState.cameraEnabled = !callState.cameraEnabled;
  callState.localStream.getVideoTracks().forEach((track) => (track.enabled = callState.cameraEnabled));
  renderApp();
}

async function endCall(shouldSignal) {
  const previous = callState;
  if (shouldSignal && previous) await sendCallSignal(previous.conversationId, "hangup", {}, previous.callId).catch(() => {});
  cleanupCall();
  renderApp();
}

function removeCallPeer(userId) {
  if (!callState?.peers || !userId || !callState.peers[userId]) return;
  const peer = callState.peers[userId];
  peer.remoteStream?.getTracks().forEach((track) => track.stop());
  peer.peerConnection?.close();
  delete callState.peers[userId];
  callState.status = getCallPeers().length ? "Dang trong cuoc goi" : "Cuoc goi da ket thuc";
}

function cleanupCall() {
  const previous = callState;
  callState = null;
  if (!previous) return;
  previous.localStream?.getTracks().forEach((track) => track.stop());
  Object.values(previous.peers || {}).forEach((peer) => {
    peer.remoteStream?.getTracks().forEach((track) => track.stop());
    peer.peerConnection?.close();
  });
}

function attachCallStreams() {
  if (!callState) return;
  const localVideo = $("#localVideo");
  if (localVideo && callState.localStream && localVideo.srcObject !== callState.localStream) {
    localVideo.srcObject = callState.localStream;
  }
  document.querySelectorAll("[data-remote-video]").forEach((video) => {
    const peer = callState.peers?.[video.dataset.remoteVideo];
    if (peer?.remoteStream && video.srcObject !== peer.remoteStream) video.srcObject = peer.remoteStream;
  });
}

function logout() {
  if (callState) {
    sendCallSignal(callState.conversationId, "hangup", {}, callState.callId).catch(() => {});
    cleanupCall();
  }
  incomingCall = null;
  if (events) events.close();
  events = null;
  token = "";
  currentUser = null;
  conversations = [];
  requests = [];
  friends = [];
  tasks = [];
  messages = [];
  conversationTasks = [];
  searchResults = [];
  activeConversationId = "";
  localStorage.removeItem(tokenKey);
  renderAuth();
}

function scrollMessagesToBottom() {
  const element = $("#messages");
  if (element) element.scrollTop = element.scrollHeight;
}

boot();
