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
let resetCodeRequested = false;
let resetEmail = "";
let activeTab = "messages";
let searchText = "";
let searchResults = [];
let events = null;
let callState = null;
let incomingCall = null;
let modal = null;
let profileModal = null;
let audioContext = null;
let ringtoneTimer = null;
let lastMessageSoundAt = 0;
let deferredInstallPrompt = null;
let mobileListOpen = false;

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

const messageSoundReasons = new Set(["message", "task-created", "friend-request", "friend-accepted", "group-created"]);

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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Không đọc được ảnh đã chọn."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("File đã chọn không phải ảnh hợp lệ."));
    image.src = dataUrl;
  });
}

async function resizeAvatarFile(file) {
  if (!file) return "";
  if (!file.type.startsWith("image/")) throw new Error("Vui lòng chọn đúng file ảnh.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Ảnh quá lớn. Vui lòng chọn ảnh dưới 8MB.");

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const maxSize = 512;
  const ratio = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.86);
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
  if (!response.ok) throw new Error(data.error || "Có lỗi xảy ra.");
  return data;
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2800);
}

function getAudioContext() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return null;
  if (!audioContext) audioContext = new Context();
  return audioContext;
}

function unlockAudio() {
  const context = getAudioContext();
  if (!context || context.state !== "suspended") return;
  context.resume().catch(() => {});
}

function playTone(frequency, duration, delay = 0, volume = 0.045, type = "sine") {
  const context = getAudioContext();
  if (!context || context.state !== "running") return;

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + delay;
  const end = start + duration;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

function playMessageSound() {
  const now = Date.now();
  if (now - lastMessageSoundAt < 700) return;
  lastMessageSoundAt = now;
  unlockAudio();
  playTone(740, 0.11, 0, 0.045, "sine");
  playTone(980, 0.13, 0.14, 0.04, "sine");
}

function playRingtoneTick() {
  unlockAudio();
  playTone(880, 0.18, 0, 0.06, "triangle");
  playTone(660, 0.22, 0.24, 0.05, "triangle");
}

function startRingtone() {
  stopRingtone();
  playRingtoneTick();
  ringtoneTimer = window.setInterval(playRingtoneTick, 1450);
}

function stopRingtone() {
  if (!ringtoneTimer) return;
  window.clearInterval(ringtoneTimer);
  ringtoneTimer = null;
}

function shouldPlayRefreshSound(payload) {
  if (!payload?.actorId || payload.actorId === currentUser?.id) return false;
  return messageSoundReasons.has(payload.reason);
}

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
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
  events.addEventListener("refresh", async (event) => {
    let payload = {};
    try {
      payload = JSON.parse(event.data);
    } catch {
      payload = {};
    }
    const playSound = shouldPlayRefreshSound(payload);
    const previous = activeConversationId;
    await refreshData({ keepMessages: true });
    if (previous && conversations.some((item) => item.id === previous)) activeConversationId = previous;
    await loadMessages(activeConversationId);
    renderApp();
    if (playSound) playMessageSound();
  });
  events.addEventListener("call-signal", (event) => {
    try {
      handleCallSignal(JSON.parse(event.data)).catch(() => showToast("Tín hiệu cuộc gọi bị lỗi."));
    } catch {
      showToast("Không đọc được tín hiệu cuộc gọi.");
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
            <p>Đăng ký Gmail và chat trực tuyến</p>
          </div>
        </div>

        <div class="auth-tabs">
          <button type="button" class="${authMode === "login" ? "active" : ""}" data-auth-tab="login">Đăng nhập</button>
          <button type="button" class="${authMode === "register" ? "active" : ""}" data-auth-tab="register">Đăng ký</button>
          <button type="button" class="${authMode === "forgot" ? "active" : ""}" data-auth-tab="forgot">Quên mật khẩu</button>
        </div>

        <form id="authForm">
          <div class="field ${authMode === "register" ? "" : "hidden"}">
            <label for="name">Tên hiển thị</label>
            <input id="name" name="name" autocomplete="name" placeholder="Nguyen Van A">
          </div>
          <div class="field">
            <label for="email">Gmail</label>
            <input id="email" name="email" type="email" autocomplete="email" placeholder="ban@gmail.com" value="${escapeAttr(authMode === "forgot" ? resetEmail : "")}" required>
          </div>
          <div class="field ${authMode === "forgot" && resetCodeRequested ? "" : "hidden"}">
            <label for="resetCode">Mã xác nhận 6 số</label>
            <input id="resetCode" name="resetCode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="123456">
          </div>
          <div class="field ${authMode === "forgot" && !resetCodeRequested ? "hidden" : ""}">
            <label for="password">Mật khẩu</label>
            <input id="password" name="password" type="password" autocomplete="${authMode === "login" ? "current-password" : "new-password"}" placeholder="Tối thiểu 6 ký tự" ${authMode === "forgot" && !resetCodeRequested ? "" : "required"}>
          </div>
          <button class="primary-btn" type="submit">${authMode === "login" ? "Đăng nhập" : authMode === "register" ? "Tạo tài khoản" : resetCodeRequested ? "Đổi mật khẩu" : "Gửi mã xác nhận"}</button>
          <p class="error" id="authError"></p>
        </form>

        <p class="hint ${authMode === "forgot" ? "" : "hidden"}">
          Mã gồm 6 chữ số không lặp lại và có hiệu lực trong 10 phút.
        </p>
        <p class="hint ${authMode === "forgot" ? "hidden" : ""}">
          Tài khoản thử: <strong>demo1@gmail.com</strong>, <strong>demo2@gmail.com</strong>,
          <strong>demo3@gmail.com</strong> / <strong>123456</strong>.
        </p>
      </section>

      <section class="preview" aria-hidden="true">
        <div class="phone-preview">
          <div class="phone-screen">
            <div class="preview-top">
              <strong>Chat, nhóm, việc</strong>
              <span>Tìm Gmail, kết bạn, tạo nhóm, giao việc</span>
            </div>
            <div class="preview-list">
              ${["Tạo nhóm 3 người", "Ghim tin quan trọng", "Giao việc trong nhóm", "Hồ sơ và giao diện"]
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
      if (authMode !== "forgot") resetCodeRequested = false;
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
  const resetCode = String(form.get("resetCode") || "").trim();
  const error = $("#authError");
  error.textContent = "";

  if (!isGmail(email)) return (error.textContent = "Vui lòng dùng địa chỉ @gmail.com.");
  if (authMode === "forgot") return handlePasswordReset(email, resetCode, password, error);
  if (password.length < 6) return (error.textContent = "Mật khẩu cần tối thiểu 6 ký tự.");
  if (authMode === "register" && !name) return (error.textContent = "Vui lòng nhập tên hiển thị.");

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

async function handlePasswordReset(email, resetCode, password, error) {
  try {
    if (!resetCodeRequested) {
      const data = await api("/api/password-reset/request", {
        method: "POST",
        body: { email }
      });
      resetEmail = email;
      resetCodeRequested = true;
      renderAuth();
      const message = data.emailConfigured
        ? "Mã xác nhận đã được gửi về Gmail của bạn."
        : "Server chưa cấu hình gửi email. Hãy thêm SMTP trong Render để gửi mã thật.";
      showToast(data.debugCode ? `${message} Mã demo: ${data.debugCode}` : message);
      return;
    }

    if (!/^\d{6}$/.test(resetCode)) {
      error.textContent = "Vui lòng nhập mã xác nhận gồm 6 chữ số.";
      return;
    }
    if (new Set(resetCode).size !== 6) {
      error.textContent = "Mã xác nhận không được lặp chữ số.";
      return;
    }
    if (password.length < 6) {
      error.textContent = "Mật khẩu cần tối thiểu 6 ký tự.";
      return;
    }

    await api("/api/password-reset/confirm", {
      method: "POST",
      body: { email, code: resetCode, password }
    });
    authMode = "login";
    resetCodeRequested = false;
    resetEmail = "";
    renderAuth();
    showToast("Đã đổi mật khẩu. Bạn có thể đăng nhập bằng mật khẩu mới.");
  } catch (err) {
    error.textContent = err.message;
  }
}

function renderApp() {
  applyTheme();
  const active = getActiveConversation();
  $("#app").innerHTML = `
    <main class="app-shell tab-${escapeAttr(activeTab)} ${mobileListOpen ? "mobile-list-open" : ""}">
      <nav class="rail" aria-label="Điều hướng">
        ${renderAvatar(currentUser)}
        <button class="icon-btn ${activeTab === "messages" ? "active" : ""}" data-rail-tab="messages" title="Tin nhắn">Tin nhắn</button>
        <button class="icon-btn ${activeTab === "friends" ? "active" : ""}" data-rail-tab="friends" title="Danh bạ">Danh bạ</button>
        <button class="icon-btn ${activeTab === "groups" ? "active" : ""}" data-rail-tab="groups" title="Nhóm">Nhóm</button>
        <button class="icon-btn ${activeTab === "tasks" ? "active" : ""}" data-rail-tab="tasks" title="Công việc">Công việc</button>
        <div class="rail-spacer"></div>
        <button class="icon-btn" id="settingsBtn" title="Cá nhân">Cá nhân</button>
      </nav>

      <aside class="sidebar">
        <div class="search-zone">
          <label class="search-box">
            <span>@</span>
            <input id="searchInput" value="${escapeAttr(searchText)}" placeholder="Nhập Gmail, bạn bè, nhóm">
          </label>
          <div class="quick-actions">
            <button class="small-btn" id="searchBtn">Tìm Gmail</button>
            <button class="small-btn" id="newGroupBtn">Tạo nhóm</button>
          </div>
        </div>

        <div class="section-tabs wide">
          ${renderTab("messages", "Tin nhắn")}
          ${renderTab("search", "Tìm bạn")}
          ${renderTab("friends", `Bạn bè ${friends.length}`)}
          ${renderTab("groups", "Nhóm")}
          ${renderTab("tasks", "Công việc")}
          ${renderTab("requests", `Lời mời ${requests.length ? `(${requests.length})` : ""}`)}
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

function friendStatusLabel(status) {
  const labels = {
    self: "Chính bạn",
    friend: "Bạn bè",
    requested: "Đã gửi lời mời",
    incoming: "Đang chờ nhận",
    none: "Chưa kết bạn"
  };
  return labels[status] || "";
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
    return `<div class="empty-state">Nhập Gmail rồi bấm Tìm Gmail để gửi lời mời kết bạn.</div>`;
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
  if (!friends.length) return `<div class="empty-state">Bạn chưa có bạn bè. Hãy tìm Gmail để kết bạn.</div>`;
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
            <button class="mini-action ghost" data-profile="${escapeAttr(friend.id)}">Hồ sơ</button>
            <button class="mini-action" data-open-conversation="${escapeAttr(friend.conversationId)}">Chat</button>
          </div>
        </div>
      `
    )
    .join("");
}

function renderGroupsList() {
  const groups = conversations.filter((item) => item.type === "group");
  if (!groups.length) return `<div class="empty-state">Chưa có nhóm. Cần ít nhất 3 người đã kết bạn với nhau để tạo nhóm.</div>`;
  return groups.map((item) => renderConversationButton(item)).join("");
}

function renderConversationList() {
  const query = searchText.trim().toLowerCase();
  const list = conversations.filter((item) => {
    const haystack = `${item.peer.name} ${item.peer.email} ${item.lastMessage?.text || ""}`.toLowerCase();
    return haystack.includes(query);
  });
  if (!list.length) return `<div class="empty-state">Chưa có cuộc trò chuyện nào.</div>`;
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
        ${item.type === "group" ? `<span class="status-label slim">Nhóm</span>` : ""}
        ${openTasks ? `<span class="badge">${openTasks}</span>` : ""}
      </div>
    </button>
  `;
}

function renderTasksList(list, showConversation) {
  if (!list.length) return `<div class="empty-state">Chưa có công việc nào.</div>`;
  return list
    .map(
      (task) => `
        <div class="task-row ${task.status === "done" ? "done" : ""}">
          <div>
            <strong>${escapeHtml(task.title)}</strong>
            <p>${escapeHtml(task.description || "Không có mô tả")}</p>
            <span>${escapeHtml(task.assignee?.name || "Chưa gán")} ${showConversation ? `- ${escapeHtml(task.conversationName || "")}` : ""}</span>
          </div>
          <button class="mini-action ${task.status === "done" ? "ghost" : ""}" data-task-toggle="${escapeAttr(task.id)}" data-next-status="${task.status === "done" ? "open" : "done"}">
            ${task.status === "done" ? "Mở lại" : "Xong"}
          </button>
        </div>
      `
    )
    .join("");
}

function renderRequestsList() {
  if (!requests.length) return `<div class="empty-state">Chưa có lời mời kết bạn nào.</div>`;
  return requests
    .map(
      (request) => `
        <div class="contact-row padded">
          ${renderAvatar(request.from, "orange")}
          <div>
            <strong>${escapeHtml(request.from.name)}</strong>
            <p>${escapeHtml(request.from.email)}</p>
          </div>
          <button class="mini-action" data-accept="${escapeAttr(request.id)}">Nhận</button>
        </div>
      `
    )
    .join("");
}

function renderFriendAction(user) {
  if (user.status === "friend") return `<span class="status-label">Bạn bè</span>`;
  if (user.status === "requested") return `<span class="status-label">Đã gửi</span>`;
  if (user.status === "incoming") return `<span class="status-label">Chờ nhận</span>`;
  return `<button class="mini-action" data-add-friend="${escapeAttr(user.email)}">Kết bạn</button>`;
}

function renderChat(active) {
  return `
    <header class="chat-header">
      <div class="person" data-profile="${active.type === "direct" ? escapeAttr(active.peer.id) : ""}">
        ${renderAvatar(active.peer)}
        <div>
          <strong>${escapeHtml(active.peer.name)}</strong>
          <span>${escapeHtml(active.type === "group" ? active.peer.email : `${active.peer.email} - đang sẵn sàng chat`)}</span>
        </div>
      </div>
      <div class="header-actions">
        <button class="mobile-only" title="Mở danh sách" id="mobileListBtn">Danh sách</button>
        <button title="${active.type === "group" ? "Gọi nhóm" : "Gọi video"}" id="videoCallBtn">${active.type === "group" ? "Gọi nhóm" : "Gọi video"}</button>
        <button title="Giao việc" id="newTaskBtn">Giao việc</button>
      </div>
    </header>

    ${active.pinnedMessage ? renderPinnedMessage(active.pinnedMessage) : ""}

    <div class="messages" id="messages">
      <div class="date-chip">Hôm nay</div>
      ${messages.map((message) => renderMessage(message)).join("")}
    </div>

    <form class="composer" id="messageForm">
      <button class="tool-btn" type="button" id="emojiBtn" title="Biểu cảm">:)</button>
      <textarea id="messageInput" rows="1" placeholder="Nhập tin nhắn..."></textarea>
      <button class="send-btn" title="Gửi" type="submit">Gửi</button>
    </form>
  `;
}

function renderPinnedMessage(message) {
  return `
    <div class="pinned-bar">
      <strong>Đã ghim</strong>
      <span>${escapeHtml(message.text)}</span>
      <button class="mini-action ghost" id="unpinBtn">Bỏ ghim</button>
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
        <button class="pin-message-btn" data-pin-message="${escapeAttr(message.id)}">${message.isPinned ? "Đang ghim" : "Ghim"}</button>
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
        <h3>Thành viên</h3>
        ${(active.members || [])
          .map(
            (member) => `
              <div class="contact-row">
                ${renderAvatar(member)}
                <div>
                  <strong>${escapeHtml(member.name)}</strong>
                  <p>${escapeHtml(member.email)}</p>
                </div>
                <button class="mini-action ghost" data-profile="${escapeAttr(member.id)}">Hồ sơ</button>
              </div>
            `
          )
          .join("")}
      </div>
      <div class="detail-block">
        <h3>Công việc trong nhóm</h3>
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
      <button class="muted-btn" data-profile="${escapeAttr(active.peer.id)}">Xem hồ sơ</button>
    </div>
    <div class="detail-block">
      <button class="muted-btn danger-text" data-unfriend="${escapeAttr(active.peer.id)}">Xóa kết bạn</button>
    </div>
    <div class="detail-block">
      <h3>Công việc liên quan</h3>
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
      <h3>Thống kê</h3>
      <p class="detail-copy">${friends.length} bạn bè - ${conversations.filter((item) => item.type === "group").length} nhóm</p>
    </div>
  `;
}

function renderEmptyChat() {
  return `
    <div class="empty-chat">
      <h2>Bắt đầu bằng Gmail</h2>
      <p>Kết bạn, tạo nhóm 3 người, giao việc, ghim tin nhắn và gọi video.</p>
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
          <h2>Tạo nhóm mới</h2>
          <button type="button" class="modal-close" data-close-modal>x</button>
        </header>
        <div class="field">
          <label>Tên nhóm</label>
          <input name="name" placeholder="Ví dụ: Nhóm dự án">
        </div>
        <div class="member-picker">
          <p>Chọn ít nhất 2 bạn bè. Tất cả thành viên cần đã kết bạn với nhau.</p>
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
        <button class="primary-btn" type="submit">Tạo nhóm</button>
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
          <h2>Giao việc</h2>
          <button type="button" class="modal-close" data-close-modal>x</button>
        </header>
        <div class="field">
          <label>Tên việc</label>
          <input name="title" placeholder="Nhập việc cần làm">
        </div>
        <div class="field">
          <label>Giao cho</label>
          <select name="assigneeId">
            ${members.map((member) => `<option value="${escapeAttr(member.id)}">${escapeHtml(member.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Mô tả</label>
          <textarea name="description" rows="3" placeholder="Nội dung, deadline, ghi chú..."></textarea>
        </div>
        <button class="primary-btn" type="submit">Giao việc</button>
      </form>
    </div>
  `;
}

function renderSettingsModal() {
  return `
    <div class="modal-layer">
      <form class="modal-panel" id="settingsForm">
        <header>
          <h2>Cài đặt tài khoản</h2>
          <button type="button" class="modal-close" data-close-modal>x</button>
        </header>
        <div class="profile-preview">
          ${renderAvatar(currentUser)}
          <div>
            <strong>${escapeHtml(currentUser.name)}</strong>
            <p>${escapeHtml(currentUser.email)} - ${friends.length} bạn bè</p>
          </div>
        </div>
        <div class="field">
          <label>Tên hiển thị</label>
          <input name="name" value="${escapeAttr(currentUser.name)}">
        </div>
        <div class="field">
          <label>Ảnh đại diện bằng URL</label>
          <input name="avatarUrl" value="${escapeAttr(currentUser.avatarUrl || "")}" placeholder="https://...">
        </div>
        <div class="field">
          <label>Hoặc chọn ảnh từ máy</label>
          <input name="avatarFile" type="file" accept="image/*">
          <p class="field-hint">Ảnh sẽ được tự nén trước khi lưu làm ảnh đại diện.</p>
        </div>
        <div class="field">
          <label>Giới thiệu</label>
          <textarea name="about" rows="3">${escapeHtml(currentUser.about || "")}</textarea>
        </div>
        <div class="field">
          <label>Giao diện</label>
          <select name="theme">
            ${[
              ["light", "Sáng"],
              ["dark", "Tối"],
              ["system", "Theo hệ thống"]
            ]
              .map(([theme, label]) => `<option value="${theme}" ${currentUser.theme === theme ? "selected" : ""}>${label}</option>`)
              .join("")}
          </select>
        </div>
        <div class="install-box">
          <div>
            <strong>Ứng dụng cài đặt</strong>
            <p>${isStandaloneApp() ? "Bạn đang mở bằng bản đã cài." : "Cài app vào màn hình chính hoặc máy tính để mở nhanh hơn."}</p>
          </div>
          <button class="mini-action ghost" type="button" id="installAppBtn">${isStandaloneApp() ? "Đã cài" : "Cài ứng dụng"}</button>
        </div>
        <button class="primary-btn" type="submit">Lưu cài đặt</button>
        <button class="muted-btn danger-text settings-logout" type="button" id="settingsLogoutBtn">Đăng xuất</button>
      </form>
    </div>
  `;
}

function renderProfileModal(profile) {
  return `
    <div class="modal-layer">
      <section class="modal-panel profile-card">
        <header>
          <h2>Hồ sơ</h2>
          <button type="button" class="modal-close" data-close-profile>x</button>
        </header>
        <div class="profile-hero">
          ${renderAvatar(profile)}
          <h3>${escapeHtml(profile.name)}</h3>
          <p>${escapeHtml(profile.email)}</p>
        </div>
        <div class="profile-facts">
          <span>${profile.friendCount || 0} bạn bè</span>
          <span>${profile.groupsInCommon || 0} nhóm chung</span>
          <span>${escapeHtml(friendStatusLabel(profile.friendStatus))}</span>
        </div>
        <p class="detail-copy">${escapeHtml(profile.about || "Chưa có giới thiệu.")}</p>
        ${profile.friendStatus === "friend" ? `<button class="muted-btn danger-text" data-unfriend="${escapeAttr(profile.id)}">Xóa kết bạn</button>` : ""}
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
        <p>${escapeHtml(peer.status || `Đang chờ video của ${user.name || "thành viên"}...`)}</p>
      </div>
      <span class="video-name">${escapeHtml(user.name || "Thành viên")}</span>
    </div>
  `;
}

function renderCallLayer() {
  if (incomingCall) {
    return `
      <div class="call-layer">
        <section class="call-panel compact">
          <div class="call-avatar">${escapeHtml(incomingCall.from.avatar)}</div>
          <h2>${incomingCall.isGroup ? "Cuộc gọi nhóm đến" : "Cuộc gọi video đến"}</h2>
          <p>${escapeHtml(incomingCall.from.name)} đang gọi ${incomingCall.isGroup ? `trong ${incomingCall.conversationName}` : "cho bạn"}.</p>
          <div class="call-actions">
            <button class="call-btn danger" id="rejectCallBtn">Từ chối</button>
            <button class="call-btn accept" id="acceptCallBtn">Nhận</button>
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
            <strong>${escapeHtml(callState.title || "Cuộc gọi video")}</strong>
            <span>${escapeHtml(callState.status || "Đang kết nối...")}</span>
          </div>
          <button class="call-icon-btn" id="minimizeCallBtn" title="Thu nhỏ">-</button>
        </header>
        <div class="video-grid ${peers.length > 1 ? "multi" : ""}">
          <div class="remote-video-grid">
            ${peers.length ? peers.map(renderRemoteFrame).join("") : `
              <div class="video-frame remote">
                <div class="video-placeholder">
                  <div class="call-avatar">?</div>
                  <p>Đang chờ thành viên tham gia...</p>
                </div>
              </div>
            `}
          </div>
          <div class="video-frame local">
            <video id="localVideo" autoplay playsinline muted></video>
            <span>Bạn</span>
          </div>
        </div>
        <div class="call-actions">
          <button class="call-btn" id="toggleMicBtn">${callState.micEnabled ? "Tắt mic" : "Bật mic"}</button>
          <button class="call-btn" id="toggleCameraBtn">${callState.cameraEnabled ? "Tắt camera" : "Bật camera"}</button>
          <button class="call-btn danger" id="endCallBtn">Kết thúc</button>
        </div>
      </section>
    </div>
  `;
}

function bindAppEvents() {
  document.querySelectorAll("[data-tab], [data-rail-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.tab || button.dataset.railTab;
      if (button.dataset.railTab || window.matchMedia("(max-width: 820px)").matches) mobileListOpen = true;
      renderApp();
    });
  });

  document.querySelectorAll("[data-conversation], [data-open-conversation]").forEach((button) => {
    button.addEventListener("click", async () => {
      activeConversationId = button.dataset.conversation || button.dataset.openConversation;
      activeTab = "messages";
      mobileListOpen = false;
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
  $("#mobileListBtn")?.addEventListener("click", () => {
    mobileListOpen = true;
    renderApp();
  });
  $("#unpinBtn")?.addEventListener("click", unpinMessage);
  $("#videoCallBtn")?.addEventListener("click", startVideoCall);
  $("#acceptCallBtn")?.addEventListener("click", acceptIncomingCall);
  $("#rejectCallBtn")?.addEventListener("click", rejectIncomingCall);
  $("#endCallBtn")?.addEventListener("click", () => endCall(true));
  $("#toggleMicBtn")?.addEventListener("click", toggleMic);
  $("#toggleCameraBtn")?.addEventListener("click", toggleCamera);
  $("#minimizeCallBtn")?.addEventListener("click", () => showToast("Cuộc gọi đang hiển thị trên màn hình."));
  $("#logoutBtn")?.addEventListener("click", logout);
  $("#messageForm")?.addEventListener("submit", sendMessage);
  $("#groupForm")?.addEventListener("submit", createGroup);
  $("#taskForm")?.addEventListener("submit", createTask);
  $("#settingsForm")?.addEventListener("submit", saveSettings);
  $("#installAppBtn")?.addEventListener("click", installApp);
  $("#settingsLogoutBtn")?.addEventListener("click", logout);
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
  if (!email) return showToast("Nhập Gmail cần tìm.");
  activeTab = "search";
  try {
    const data = await api(`/api/search?email=${encodeURIComponent(email)}`);
    searchResults = data.users || [];
    if (!searchResults.length) showToast("Không tìm thấy tài khoản phù hợp.");
    renderApp();
  } catch (err) {
    showToast(err.message);
  }
}

async function sendFriendRequest(email) {
  try {
    await api("/api/friend-requests", { method: "POST", body: { email } });
    showToast("Đã gửi lời mời kết bạn.");
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
    mobileListOpen = false;
    await refreshData();
    renderApp();
    showToast("Đã chấp nhận kết bạn.");
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
    mobileListOpen = false;
    await refreshData();
    renderApp();
    showToast("Đã tạo nhóm.");
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
    showToast("Đã giao việc.");
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
  const avatarFile = form.get("avatarFile");
  try {
    const avatarUrl = avatarFile instanceof File && avatarFile.size ? await resizeAvatarFile(avatarFile) : form.get("avatarUrl");
    const data = await api("/api/me", {
      method: "PATCH",
      body: {
        name: form.get("name"),
        avatarUrl,
        about: form.get("about"),
        theme: form.get("theme")
      }
    });
    currentUser = data.user;
    localStorage.setItem("gmail-chat-theme", currentUser.theme || "light");
    modal = null;
    await refreshData({ keepMessages: true });
    renderApp();
    showToast("Đã lưu cài đặt.");
  } catch (err) {
    showToast(err.message);
  }
}

async function installApp() {
  if (isStandaloneApp()) return showToast("Ứng dụng đã được cài trên thiết bị này.");
  if (!deferredInstallPrompt) {
    showToast("Nếu chưa thấy nút cài, hãy mở menu trình duyệt và chọn Cài đặt ứng dụng hoặc Thêm vào màn hình chính.");
    return;
  }

  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  showToast(choice?.outcome === "accepted" ? "Đã bắt đầu cài ứng dụng." : "Bạn đã hủy cài ứng dụng.");
  renderApp();
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
  if (!window.confirm("Xóa kết bạn với tài khoản này?")) return;
  try {
    await api(`/api/friends/${userId}`, { method: "DELETE" });
    profileModal = null;
    await refreshData();
    renderApp();
    showToast("Đã xóa kết bạn.");
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
    showToast("Đã ghim tin nhắn.");
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
    showToast("Đã bỏ ghim.");
  } catch (err) {
    showToast(err.message);
  }
}

async function manualRefresh() {
  try {
    await refreshData();
    renderApp();
    showToast("Đã cập nhật.");
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
      showToast("Không gửi được tín hiệu kết nối video.");
    });
  };
  peerConnection.ontrack = (event) => {
    const peer = callState?.callId === callId ? callState.peers?.[remoteUser.id] : null;
    if (!peer) return;
    peer.remoteStream = event.streams[0] || peer.remoteStream || new MediaStream();
    if (!event.streams[0] && event.track) peer.remoteStream.addTrack(event.track);
    peer.status = "Đang trong cuộc gọi";
    callState.status = "Đang trong cuộc gọi";
    renderApp();
  };
  peerConnection.onconnectionstatechange = () => {
    const peer = callState?.callId === callId ? callState.peers?.[remoteUser.id] : null;
    if (!peer) return;
    if (peerConnection.connectionState === "connected") {
      peer.status = "Đang trong cuộc gọi";
      callState.status = "Đang trong cuộc gọi";
    }
    if (["failed", "disconnected"].includes(peerConnection.connectionState)) {
      peer.status = "Kết nối đang yếu";
      callState.status = "Một số kết nối đang yếu";
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
    status: "Đang kết nối...",
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
  if (!active) return showToast("Hãy chọn một cuộc trò chuyện để gọi.");
  if (callState || incomingCall) return showToast("Đang có một cuộc gọi khác.");
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    return showToast("Trình duyệt này chưa hỗ trợ video call.");
  }

  const remoteMembers = (active.members || []).filter((member) => member.id !== currentUser.id);
  if (!remoteMembers.length) return showToast("Cuộc trò chuyện này chưa có người khác để gọi.");

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
      status: active.type === "group" ? "Đang gọi nhóm..." : "Đang gọi...",
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
    showToast(err.name === "NotAllowedError" ? "Bạn cần cho phép camera và micro." : "Không bắt đầu được cuộc gọi video.");
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
        conversationName: conversation?.peer?.name || "cuộc trò chuyện",
        isGroup: conversation?.type === "group",
        from: signal.from,
        offers: {},
        pendingCandidates: {}
      };
      startRingtone();
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
  if (incomingCall && incomingCall.callId === signal.callId && ["hangup", "reject", "busy"].includes(signal.type)) {
    stopRingtone();
    incomingCall = null;
    renderApp();
    return;
  }
  if (!callState || callState.callId !== signal.callId) return;

  if (signal.type === "answer") {
    const peer = callState.peers?.[signal.from?.id];
    if (!peer) return;
    await peer.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
    await flushPendingCandidates(peer);
    peer.status = "Đang trong cuộc gọi";
    callState.status = "Đang trong cuộc gọi";
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
    showToast(`${signal.from?.name || "Một thành viên"} đã từ chối cuộc gọi.`);
    if (!getCallPeers().length) cleanupCall();
    renderApp();
    return;
  }
  if (signal.type === "busy") {
    removeCallPeer(signal.from?.id);
    showToast(`${signal.from?.name || "Đối phương"} đang bận.`);
    if (!getCallPeers().length) cleanupCall();
    renderApp();
    return;
  }
  if (signal.type === "hangup") {
    removeCallPeer(signal.from?.id);
    showToast(`${signal.from?.name || "Một thành viên"} đã rời cuộc gọi.`);
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
  stopRingtone();
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
      status: "Đang kết nối...",
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
    showToast(err.name === "NotAllowedError" ? "Bạn cần cho phép camera và micro." : "Không nhận được cuộc gọi.");
  }
}

async function rejectIncomingCall() {
  const pending = incomingCall;
  stopRingtone();
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
  callState.status = getCallPeers().length ? "Đang trong cuộc gọi" : "Cuộc gọi đã kết thúc";
}

function cleanupCall() {
  stopRingtone();
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
  stopRingtone();
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

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}

["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
  window.addEventListener(eventName, unlockAudio, { passive: true });
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  showToast("Ứng dụng đã được cài thành công.");
});

registerServiceWorker();
boot();
