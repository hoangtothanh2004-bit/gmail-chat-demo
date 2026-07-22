const tokenKey = "gmail-chat-token";

let token = localStorage.getItem(tokenKey) || "";
let currentUser = null;
let conversations = [];
let requests = [];
let friends = [];
let tasks = [];
let stories = [];
let messages = [];
let conversationTasks = [];
let activeConversationId = "";
let authMode = "login";
let resetCodeRequested = false;
let resetEmail = "";
let activeTab = "messages";
let searchText = "";
let searchResults = [];
let storyDraftType = "note";
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
let notificationPermissionAsked = false;

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

const messageSoundReasons = new Set(["message", "task-created", "friend-request", "friend-accepted", "group-created", "call-recorded", "story-created"]);
const storyVideoMaxBytes = 8 * 1024 * 1024;
const chatIcons = ["👍", "❤️", "😂", "😊", "😍", "🙏", "🎉", "🔥", "😮", "😭", "👏", "✅", "💪", "🌹", "⭐", "💯"];

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

function formatProfileDate(value) {
  if (!value) return "Chưa cập nhật";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatCallDuration(seconds = 0) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  if (hours) return `${hours} giờ ${minutes} phút ${remainingSeconds} giây`;
  return `${minutes} phút ${remainingSeconds} giây`;
}

function callDirection(message) {
  return message?.call?.startedBy === currentUser?.id ? "outgoing" : "incoming";
}

function callTitle(message) {
  const isVideo = message?.call?.mode === "video";
  const direction = callDirection(message) === "outgoing" ? "đi" : "đến";
  return `${isVideo ? "Cuộc gọi video" : "Cuộc gọi thoại"} ${direction}`;
}

function messagePreview(message) {
  if (!message) return "";
  if (message.type === "call") return callTitle(message);
  return message.text || "";
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
  const size = 512;
  const sourceSize = Math.min(image.width, image.height);
  const sourceX = Math.max(0, Math.round((image.width - sourceSize) / 2));
  const sourceY = Math.max(0, Math.round((image.height - sourceSize) / 2));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = size;
  canvas.height = size;
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.86);
}

async function resizeCoverFile(file) {
  if (!file) return "";
  if (!file.type.startsWith("image/")) throw new Error("Vui lòng chọn đúng file ảnh bìa.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Ảnh bìa quá lớn. Vui lòng chọn ảnh dưới 8MB.");

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const width = 1200;
  const height = 430;
  const scale = Math.max(width / image.width, height / image.height);
  const scaledWidth = image.width * scale;
  const scaledHeight = image.height * scale;
  const offsetX = Math.round((width - scaledWidth) / 2);
  const offsetY = Math.round((height - scaledHeight) / 2);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, offsetX, offsetY, scaledWidth, scaledHeight);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function isVideoMediaUrl(mediaUrl) {
  const value = String(mediaUrl || "").trim();
  return value.startsWith("data:video/") || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(value);
}

async function prepareStoryMediaFile(file) {
  if (!file) return "";
  if (file.type.startsWith("image/")) return resizeCoverFile(file);
  if (file.type.startsWith("video/")) {
    if (file.size > storyVideoMaxBytes) throw new Error("Video story quá lớn. Vui lòng chọn video dưới 8MB.");
    return readFileAsDataUrl(file);
  }
  throw new Error("Story chỉ hỗ trợ ảnh hoặc video.");
}

function getCallMediaConstraints(isAudioCall, facingMode = "user") {
  return {
    audio: true,
    video: isAudioCall ? false : { facingMode: { ideal: facingMode } }
  };
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

function prepareNotifications() {
  if (!("Notification" in window) || notificationPermissionAsked || Notification.permission !== "default") return;
  notificationPermissionAsked = true;
  Notification.requestPermission().catch(() => {});
}

function showDeviceNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag: "gmail-chat-call" });
  } catch {
    // Browser notifications are optional; the in-app call panel still appears.
  }
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

function unlockInteractions() {
  unlockAudio();
  prepareNotifications();
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

function isMobileLayout() {
  return window.matchMedia("(max-width: 820px)").matches;
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
    mobileListOpen = isMobileLayout();
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
  stories = data.stories || [];
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
    if (isMobileLayout()) mobileListOpen = true;
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
        <button class="rail-avatar-btn" id="railProfileBtn" title="Mở trang cá nhân" type="button">
          ${renderAvatar(currentUser)}
        </button>
        ${renderRailButton("messages", "Tin nhắn", "chat")}
        ${renderRailButton("friends", "Danh bạ", "contacts", requests.length)}
        ${renderRailButton("feed", "Bản tin", "feed", stories.length)}
        ${renderRailButton("tasks", "Công việc", "tasks", tasks.filter((task) => task.status !== "done").length)}
        <div class="rail-spacer"></div>
        <button class="icon-btn ${modal === "settings" ? "active" : ""}" id="settingsBtn" title="Cá nhân" type="button">
          <span class="nav-icon nav-icon-profile" aria-hidden="true"></span>
          <span class="nav-label">Cá nhân</span>
        </button>
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

function renderRailButton(tab, label, icon, badge = 0) {
  const badgeText = badge > 9 ? "9+" : String(badge || "");
  return `
    <button class="icon-btn ${activeTab === tab ? "active" : ""}" data-rail-tab="${escapeAttr(tab)}" title="${escapeAttr(label)}" aria-current="${activeTab === tab ? "page" : "false"}" type="button">
      <span class="nav-icon nav-icon-${escapeAttr(icon)}" aria-hidden="true"></span>
      <span class="nav-label">${escapeHtml(label)}</span>
      ${badge ? `<span class="nav-badge">${escapeHtml(badgeText)}</span>` : ""}
    </button>
  `;
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
  if (activeTab === "friends") return renderContactsPanel();
  if (activeTab === "feed") return renderFeedPanel();
  if (activeTab === "groups") return renderGroupsList();
  if (activeTab === "tasks") return renderTasksPanel();
  return renderConversationList();
}

function renderContactsPanel() {
  const requestSection = requests.length
    ? `
      <div class="panel-section">
        <div class="panel-heading">
          <strong>Lời mời kết bạn</strong>
          <span>${requests.length}</span>
        </div>
        ${renderRequestsList()}
      </div>
    `
    : "";

  return `
    ${requestSection}
    <div class="panel-section">
      <div class="panel-heading">
        <strong>Danh bạ bạn bè</strong>
        <span>${friends.length}</span>
      </div>
      ${renderFriendsList()}
    </div>
  `;
}

function renderTasksPanel() {
  const active = getActiveConversation();
  return `
    <div class="panel-toolbar">
      <div>
        <strong>Công việc</strong>
        <span>${active ? `Giao trong ${active.peer.name}` : "Chọn cuộc trò chuyện để giao việc"}</span>
      </div>
      <button class="small-btn" id="newTaskFromPanelBtn" ${active ? "" : "disabled"}>Giao việc mới</button>
    </div>
    ${renderTasksList(tasks, true)}
  `;
}

function renderSearchResults() {
  if (!searchResults.length) {
    return `<div class="empty-state">Nhập Gmail rồi bấm Tìm Gmail để gửi lời mời kết bạn.</div>`;
  }
  return `
    <div class="panel-heading standalone">
      <strong>Kết quả tìm kiếm</strong>
      <span>${searchResults.length}</span>
    </div>
    ${searchResults
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
    .join("")}
  `;
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

function storyChipStyle(story) {
  if (!story?.mediaUrl || isVideoMediaUrl(story.mediaUrl)) return "";
  return ` style="background-image: linear-gradient(135deg, rgba(15, 23, 42, 0.58), rgba(37, 99, 235, 0.46)), url('${escapeAttr(story.mediaUrl)}')"`;
}

function renderStoryMedia(mediaUrl) {
  if (!mediaUrl) return "";
  if (isVideoMediaUrl(mediaUrl)) {
    return `<video class="feed-media feed-video" src="${escapeAttr(mediaUrl)}" controls playsinline preload="metadata"></video>`;
  }
  return `<div class="feed-media" style="background-image: url('${escapeAttr(mediaUrl)}')"></div>`;
}

function renderStoryRail() {
  const visibleStories = (stories || []).slice(0, 10);
  return `
    <section class="stories-strip" aria-label="Ghi chú và story 24 giờ">
      <button class="story-add" id="newStoryBtn" type="button">
        <span>+</span>
        <strong>Tạo mới</strong>
      </button>
      ${visibleStories
        .map(
          (story) => `
            <article class="story-chip ${story.type === "story" ? "story-photo" : "story-note"} ${isVideoMediaUrl(story.mediaUrl) ? "story-video" : ""}"${storyChipStyle(story)}>
              ${renderAvatar(story.author || { avatar: "?" })}
              <div>
                <strong>${escapeHtml(story.author?.name || "Bạn bè")}</strong>
                <p>${escapeHtml(story.text || (story.type === "story" ? "Story mới" : "Ghi chú mới"))}</p>
                <small>Tự mất sau 24 giờ · ${escapeHtml(formatTime(story.createdAt))}</small>
              </div>
              ${isVideoMediaUrl(story.mediaUrl) ? `<span class="story-video-badge">Video</span>` : ""}
              ${story.userId === currentUser.id ? `<button class="story-delete" title="Xóa" type="button" data-delete-story="${escapeAttr(story.id)}">×</button>` : ""}
            </article>
          `
        )
        .join("")}
    </section>
  `;
}

function renderFeedPanel() {
  const visibleStories = stories || [];
  return `
    <section class="feed-panel">
      <div class="feed-tabs">
        <button class="active" type="button">Bản tin</button>
        <button type="button">Tin 24 giờ</button>
      </div>
      ${renderStoryRail()}
      <div class="feed-compose">
        ${renderAvatar(currentUser)}
        <button type="button" id="newStoryComposerBtn">Hôm nay bạn thế nào?</button>
        <div class="feed-compose-actions">
          <button type="button" id="newStoryPhotoBtn">Ảnh</button>
          <button type="button" id="newStoryVideoBtn">Story</button>
        </div>
      </div>
      <div class="feed-list">
        ${visibleStories.length
          ? visibleStories.map((story) => renderFeedPost(story)).join("")
          : `
            <div class="feed-empty">
              <strong>Chưa có bản tin 24 giờ.</strong>
              <p>Bấm Tạo mới để đăng ghi chú hoặc story. Tin sẽ tự mất sau 24 giờ.</p>
            </div>
          `}
      </div>
    </section>
  `;
}

function renderFeedPost(story) {
  return `
    <article class="feed-post">
      <header>
        ${renderAvatar(story.author || { avatar: "?" })}
        <div>
          <strong>${escapeHtml(story.author?.name || "Bạn bè")}</strong>
          <span>${escapeHtml(story.type === "story" ? "Story 24 giờ" : "Ghi chú 24 giờ")} · ${escapeHtml(formatTime(story.createdAt))}</span>
        </div>
        ${story.userId === currentUser.id ? `<button class="story-delete feed-delete" title="Xóa" type="button" data-delete-story="${escapeAttr(story.id)}">×</button>` : ""}
      </header>
      <p>${escapeHtml(story.text || "Đã đăng một story mới.")}</p>
      ${renderStoryMedia(story.mediaUrl)}
      <footer>
        <button type="button">♡ Thích</button>
        <button type="button">💬 Bình luận</button>
      </footer>
    </article>
  `;
}

function renderConversationList() {
  const query = searchText.trim().toLowerCase();
  const list = conversations.filter((item) => {
    const haystack = `${item.peer.name} ${item.peer.email} ${messagePreview(item.lastMessage)}`.toLowerCase();
    return haystack.includes(query);
  });
  const listHtml = list.length
    ? list.map((item) => renderConversationButton(item)).join("")
    : `<div class="empty-state">Chưa có cuộc trò chuyện nào.</div>`;
  return listHtml;
}

function renderConversationButton(item) {
  const last = item.lastMessage;
  const openTasks = item.taskSummary?.open || 0;
  return `
    <button class="conversation ${item.id === activeConversationId ? "active" : ""}" data-conversation="${escapeAttr(item.id)}">
        ${renderAvatar(item.peer)}
      <div>
        <strong>${escapeHtml(item.peer.name)}</strong>
        <p>${escapeHtml(item.pinnedMessage ? `Ghim: ${messagePreview(item.pinnedMessage)}` : last ? messagePreview(last) : item.peer.email)}</p>
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
  const personAction = active.type === "group"
    ? `data-group-options="${escapeAttr(active.id)}"`
    : `data-profile="${escapeAttr(active.peer.id)}"`;
  const messagesStyle = active.backgroundUrl
    ? ` style="background-image: linear-gradient(180deg, rgba(239, 246, 255, 0.72), rgba(239, 246, 255, 0.86)), url('${escapeAttr(active.backgroundUrl)}')"`
    : "";
  return `
    <header class="chat-header">
      <button class="mobile-back-btn" id="mobileBackBtn" title="Quay lại danh sách" type="button">‹</button>
      <div class="person" ${personAction}>
        ${renderAvatar(active.peer)}
        <div>
          <strong>${escapeHtml(active.peer.name)}</strong>
          <span>${escapeHtml(active.type === "group" ? active.peer.email : `${active.peer.email} - đang sẵn sàng chat`)}</span>
        </div>
      </div>
      <div class="header-actions">
        <button title="${active.type === "group" ? "Gọi thoại nhóm" : "Gọi thoại"}" id="audioCallBtn">Gọi thoại</button>
        <button title="${active.type === "group" ? "Gọi video nhóm" : "Gọi video"}" id="videoCallBtn">Gọi video</button>
      </div>
    </header>

    ${active.pinnedMessage ? renderPinnedMessage(active.pinnedMessage) : ""}

    <div class="messages" id="messages"${messagesStyle}>
      <div class="date-chip">Hôm nay</div>
      ${messages.map((message) => renderMessage(message)).join("")}
    </div>

    <div class="icon-tray hidden" id="iconTray" aria-label="Chọn icon nhắn tin">
      ${chatIcons.map((icon) => `<button type="button" class="icon-choice" data-chat-icon="${escapeAttr(icon)}">${escapeHtml(icon)}</button>`).join("")}
    </div>

    <form class="composer" id="messageForm">
      <button class="tool-btn" type="button" id="emojiBtn" title="Chọn icon">☺</button>
      <textarea id="messageInput" rows="1" placeholder="Nhập tin nhắn..."></textarea>
      <button class="send-btn" title="Gửi" type="submit">Gửi</button>
    </form>
  `;
}

function renderPinnedMessage(message) {
  return `
    <div class="pinned-bar">
      <strong>Đã ghim</strong>
      <span>${escapeHtml(messagePreview(message))}</span>
      <button class="mini-action ghost" id="unpinBtn">Bỏ ghim</button>
    </div>
  `;
}

function renderMessage(message) {
  const isCallMessage = message.type === "call";
  const isMe = isCallMessage ? callDirection(message) === "outgoing" : message.senderId === currentUser.id;
  if (isCallMessage) return renderCallHistoryMessage(message, isMe);
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

function renderCallHistoryMessage(message, isMe) {
  const duration = formatCallDuration(message.call?.durationSeconds || 0);
  const isOutgoing = callDirection(message) === "outgoing";
  const mode = message.call?.mode === "video" ? "video" : "audio";
  return `
    <div class="message call-message ${isMe ? "me" : ""}">
      ${renderAvatar(message.sender || { avatar: "?" })}
      <div class="call-history-card">
        <strong>${escapeHtml(callTitle(message))}</strong>
        <p><span class="call-history-icon ${isOutgoing ? "outgoing" : "incoming"}">${isOutgoing ? "↗" : "↙"}</span>${escapeHtml(duration)}</p>
        <button type="button" data-call-again="${escapeAttr(mode)}">Gọi lại</button>
        <time>${escapeHtml(formatTime(message.createdAt))}</time>
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
      <div class="detail-block group-danger-actions">
        <button class="muted-btn danger-text" data-leave-group="${escapeAttr(active.id)}">Rời nhóm</button>
        ${active.canManage ? `<button class="muted-btn danger-text" data-delete-group="${escapeAttr(active.id)}">Xóa nhóm</button>` : ""}
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
      <p>Kết bạn, tạo nhóm 3 người, giao việc, ghim tin nhắn, gọi thoại và gọi video.</p>
    </div>
  `;
}

function renderModalLayer() {
  if (profileModal) return renderProfileModal(profileModal);
  if (modal === "group") return renderGroupModal();
  if (modal === "task") return renderTaskModal();
  if (modal === "story") return renderStoryModal();
  if (modal === "groupOptions") return renderGroupOptionsModal();
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

function renderStoryModal() {
  return `
    <div class="modal-layer">
      <form class="modal-panel story-modal" id="storyForm">
        <header>
          <h2>Đăng ghi chú / story 24 giờ</h2>
          <button type="button" class="modal-close" data-close-modal>←</button>
        </header>
        <div class="story-type-picker">
          <label>
            <input type="radio" name="type" value="note" ${storyDraftType === "story" ? "" : "checked"}>
            <span>Ghi chú 24 giờ</span>
          </label>
          <label>
            <input type="radio" name="type" value="story" ${storyDraftType === "story" ? "checked" : ""}>
            <span>Story 24 giờ</span>
          </label>
        </div>
        <div class="field">
          <label>Nội dung</label>
          <textarea name="text" rows="4" maxlength="500" placeholder="Bạn đang nghĩ gì?"></textarea>
        </div>
        <div class="field">
          <label>Ảnh hoặc video story nếu muốn</label>
          <input name="mediaFile" type="file" accept="image/*,video/*">
          <p class="field-hint">Video story nên dưới 8MB để bản demo tải nhanh. Story và ghi chú sẽ tự mất sau 24 giờ.</p>
        </div>
        <button class="primary-btn" type="submit">Đăng 24 giờ</button>
      </form>
    </div>
  `;
}

function renderGroupOptionsModal() {
  const active = getActiveConversation();
  if (!active || active.type !== "group") return "";
  const availableFriends = friends.filter((friend) => !(active.members || []).some((member) => member.id === friend.id));
  const groupLink = `${window.location.origin}/?group=${encodeURIComponent(active.id)}`;
  return `
    <div class="modal-layer group-options-layer">
      <form class="modal-panel group-options-panel" id="groupOptionsForm">
        <header class="group-options-nav">
          <button type="button" class="modal-close back-style" data-close-modal aria-label="Quay lại">←</button>
          <h2>Tùy chọn</h2>
        </header>

        <section class="group-options-hero">
          <label class="group-avatar-edit">
            ${renderAvatar(active.peer)}
            <input name="groupAvatarFile" type="file" accept="image/*">
            <span>📷</span>
          </label>
          <div class="group-title-edit">
            <input name="name" value="${escapeAttr(active.name || active.peer.name)}" maxlength="80">
            <small>${escapeHtml(active.peer.email)}</small>
          </div>
        </section>

        <input name="avatarUrl" type="hidden" value="${escapeAttr(active.avatarUrl || active.peer.avatarUrl || "")}">
        <input name="backgroundUrl" type="hidden" value="${escapeAttr(active.backgroundUrl || active.peer.backgroundUrl || "")}">

        <section class="group-quick-actions">
          <button type="button" data-group-search>
            <span>⌕</span>
            <strong>Tìm tin nhắn</strong>
          </button>
          <label>
            <span>👥</span>
            <strong>Thêm thành viên</strong>
            <input class="hidden-file" name="memberPanelToggle" type="checkbox">
          </label>
          <label>
            <span>🎨</span>
            <strong>Đổi hình nền</strong>
            <input class="hidden-file" name="groupBackgroundFile" type="file" accept="image/*">
          </label>
          <button type="button" data-group-notification>
            <span>🔔</span>
            <strong>Bật thông báo</strong>
          </button>
        </section>

        <section class="group-option-section">
          <label class="field">
            <span>Thêm mô tả nhóm</span>
            <textarea name="description" rows="2" maxlength="240" placeholder="Nhập mô tả nhóm...">${escapeHtml(active.description || "")}</textarea>
          </label>
        </section>

        <section class="group-option-section">
          <h3>Thêm thành viên</h3>
          <div class="member-picker compact">
            ${availableFriends.length
              ? availableFriends
                .map(
                  (friend) => `
                    <label class="check-row">
                      <input type="checkbox" name="memberIds" value="${escapeAttr(friend.id)}">
                      ${renderAvatar(friend)}
                      <span>${escapeHtml(friend.name)}<small>${escapeHtml(friend.email)}</small></span>
                    </label>
                  `
                )
                .join("")
              : `<p class="detail-copy">Tất cả bạn bè phù hợp đã ở trong nhóm.</p>`}
          </div>
        </section>

        <section class="group-option-section">
          <h3>Ảnh, file, link</h3>
          <div class="group-media-strip">
            ${(messages || []).slice(-4).map((message) => `<span>${escapeHtml(messagePreview(message)).slice(0, 24) || "Tin nhắn"}</span>`).join("")}
            <button type="button" data-group-search>→</button>
          </div>
        </section>

        <section class="group-option-list">
          <button type="button" data-group-calendar><span>▦</span>Lịch nhóm</button>
          <button type="button" data-group-pins><span>📌</span>Tin nhắn đã ghim</button>
          <button type="button" data-group-poll><span>▥</span>Bình chọn</button>
          <button type="button" data-group-members><span>👥</span>Xem thành viên (${(active.members || []).length})</button>
          <button type="button" data-copy-group-link="${escapeAttr(groupLink)}"><span>🔗</span><em>Link nhóm</em><small>${escapeHtml(groupLink)}</small></button>
        </section>

        <section class="group-option-list">
          <label><span>📌</span>Ghim trò chuyện<input type="checkbox"></label>
          <label><span>◌</span>Ẩn trò chuyện<input type="checkbox"></label>
          <button type="button" data-group-personal><span>⚙</span>Cài đặt cá nhân</button>
        </section>

        <section class="group-option-list danger-list">
          <button type="button" data-group-report><span>!</span>Báo xấu</button>
          <button type="button" data-group-storage><span>◴</span>Dung lượng trò chuyện</button>
          <button type="button" class="danger-text" id="clearGroupHistoryBtn"><span>🗑</span>Xóa lịch sử trò chuyện</button>
          <button type="button" class="danger-text" data-leave-group="${escapeAttr(active.id)}"><span>↪</span>Rời nhóm</button>
          ${active.canManage ? `<button type="button" class="danger-text" data-delete-group="${escapeAttr(active.id)}"><span>×</span>Xóa nhóm</button>` : ""}
        </section>

        <button class="primary-btn group-save-btn" type="submit">Lưu tùy chọn nhóm</button>
      </form>
    </div>
  `;
}

function profileValue(value) {
  return value ? String(value) : "Chưa cập nhật";
}

function renderProfileInfoRow(label, value) {
  return `
    <div class="profile-info-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <i aria-hidden="true">✎</i>
    </div>
  `;
}

function renderRecentActivities() {
  const recent = [];
  const lastConversation = conversations.find((item) => item.lastMessage);
  if (lastConversation) {
    recent.push({
      avatar: lastConversation.peer,
      title: `${lastConversation.peer.name} có hoạt động mới.`,
      text: messagePreview(lastConversation.lastMessage)
    });
  }
  const activeTask = tasks.find((task) => task.status !== "done") || tasks[0];
  if (activeTask) {
    recent.push({
      avatar: activeTask.assignee || currentUser,
      title: `${activeTask.assignee?.name || currentUser.name} đang có công việc.`,
      text: activeTask.title
    });
  }
  if (!recent.length) {
    recent.push({
      avatar: currentUser,
      title: `${currentUser.name} đã tạo tài khoản.`,
      text: "Bắt đầu kết bạn và trò chuyện bằng Gmail."
    });
  }

  return recent
    .slice(0, 2)
    .map(
      (item) => `
        <div class="activity-row">
          ${renderAvatar(item.avatar)}
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.text)}</p>
          </div>
        </div>
      `
    )
    .join("");
}

function renderSettingsModal() {
  const coverStyle = currentUser.coverUrl
    ? ` style="background-image: linear-gradient(180deg, rgba(15, 23, 42, 0.12), rgba(15, 23, 42, 0.22)), url('${escapeAttr(currentUser.coverUrl)}')"`
    : "";
  const friendPreview = friends.slice(0, 8);
  const mediaPreview = [currentUser, ...friends].slice(0, 5);

  return `
    <div class="modal-layer profile-modal-layer">
      <form class="modal-panel settings-panel profile-page-panel" id="settingsForm">
        <header class="profile-page-top">
          <button type="button" class="profile-close-btn" data-close-modal aria-label="Quay lại">←</button>
          <h2>Trang cá nhân</h2>
          <details class="profile-settings-menu" id="profileSettingsDetails">
            <summary aria-label="Mở cài đặt">⚙</summary>
            <div class="settings-menu-panel">
              <div class="settings-menu-header">
                <button type="button" id="profileSettingsBackBtn" aria-label="Quay lại trang cá nhân">←</button>
                <strong>Cài đặt</strong>
              </div>
              <section class="settings-menu-section">
                <h3>Cài đặt thông tin</h3>
                <div class="field">
                  <label>Tên hiển thị</label>
                  <input name="name" value="${escapeAttr(currentUser.name)}">
                </div>
                <div class="field">
                  <label>Giới thiệu</label>
                  <textarea name="about" rows="3">${escapeHtml(currentUser.about || "")}</textarea>
                </div>
              </section>

              <section class="settings-menu-section">
                <h3>Thay đổi Gmail</h3>
                <div class="field">
                  <label>Gmail đăng nhập</label>
                  <input name="email" value="${escapeAttr(currentUser.email)}" inputmode="email" autocomplete="email">
                  <p class="field-hint">Sau khi lưu, bạn sẽ đăng nhập bằng Gmail mới này.</p>
                </div>
              </section>

              <section class="settings-menu-section">
                <h3>Thông tin cá nhân</h3>
                <div class="field">
                  <label>Ngày sinh</label>
                  <input name="birthday" type="date" value="${escapeAttr(currentUser.birthday || "")}">
                </div>
                <div class="field">
                  <label>Giới tính</label>
                  <select name="gender">
                    ${["", "Nam", "Nữ", "Khác"]
                      .map((gender) => `<option value="${escapeAttr(gender)}" ${currentUser.gender === gender ? "selected" : ""}>${gender || "Chưa cập nhật"}</option>`)
                      .join("")}
                  </select>
                </div>
                <div class="field">
                  <label>Quê quán</label>
                  <input name="hometown" value="${escapeAttr(currentUser.hometown || "")}" placeholder="Ví dụ: Phú Thọ">
                </div>
              </section>

              <details class="settings-menu-section theme-dropdown">
                <summary class="settings-heading">
                  <strong>Cài đặt giao diện</strong>
                  <p>Chọn độ sáng phù hợp với cách bạn sử dụng ứng dụng.</p>
                  <i aria-hidden="true"></i>
                </summary>
                <div class="theme-options">
                  ${[
                    ["light", "Sáng", "Nền trắng, chữ đậm dễ đọc"],
                    ["dark", "Tối", "Nền tối dịu mắt khi dùng ban đêm"],
                    ["system", "Hệ thống", "Tự đổi theo thiết bị"]
                  ]
                    .map(
                      ([theme, label, note]) => `
                        <label class="theme-option">
                          <input type="radio" name="theme" value="${theme}" ${currentUser.theme === theme ? "checked" : ""}>
                          <span>
                            <strong>${label}</strong>
                            <small>${note}</small>
                          </span>
                        </label>
                      `
                    )
                    .join("")}
                </div>
              </details>

              <section class="settings-menu-section">
                <div class="install-box compact">
                  <div>
                    <strong>Cài đặt ứng dụng</strong>
                    <p>${isStandaloneApp() ? "Bạn đang mở bằng bản đã cài." : "Cài app vào màn hình chính hoặc máy tính để mở nhanh hơn."}</p>
                  </div>
                  <button class="mini-action ghost" type="button" id="installAppBtn">${isStandaloneApp() ? "Đã cài" : "Cài ứng dụng"}</button>
                </div>
              </section>

              <div class="settings-actions">
                <button class="primary-btn" type="submit">Lưu cài đặt</button>
                <button class="muted-btn danger-text settings-logout" type="button" id="settingsLogoutBtn">Đăng xuất</button>
              </div>
            </div>
          </details>
        </header>

        <input name="avatarUrl" type="hidden" value="${escapeAttr(currentUser.avatarUrl || "")}">
        <input name="coverUrl" type="hidden" value="${escapeAttr(currentUser.coverUrl || "")}">

        <section class="profile-page">
          <div class="profile-cover"${coverStyle}>
            <label class="cover-upload">
              <input name="coverFile" type="file" accept="image/*">
              <span>Thay đổi ảnh bìa</span>
            </label>
          </div>

          <div class="profile-identity">
            <label class="profile-avatar-upload">
              ${renderAvatar(currentUser)}
              <input name="avatarFile" type="file" accept="image/*">
              <span>Thay đổi ảnh đại diện</span>
            </label>
            <div class="profile-name-row">
              <div>
                <h3>${escapeHtml(currentUser.name)}</h3>
                <p>${escapeHtml(currentUser.about || "Thêm giới thiệu cho trang cá nhân của bạn.")}</p>
              </div>
            </div>
          </div>

          <section class="profile-block">
            <h3>Thông tin cơ bản</h3>
            ${renderProfileInfoRow("Ngày sinh", formatProfileDate(currentUser.birthday))}
            ${renderProfileInfoRow("Giới tính", profileValue(currentUser.gender))}
            ${renderProfileInfoRow("Quê quán", profileValue(currentUser.hometown))}
          </section>

          <section class="profile-block">
            <h3>Hoạt động gần đây</h3>
            ${renderRecentActivities()}
          </section>

          <section class="profile-block profile-friends-block">
            <div class="profile-block-title">
              <h3>Bạn bè</h3>
              <button type="button" class="mini-action ghost" id="profileFriendsBtn">Xem tất cả</button>
            </div>
            <div class="friend-strip">
              ${friendPreview.length ? friendPreview.map((friend) => `<span>${renderAvatar(friend)}<i></i></span>`).join("") : `<p>Chưa có bạn bè.</p>`}
            </div>
          </section>

          <section class="profile-block">
            <div class="profile-block-title">
              <h3>Ảnh & Video</h3>
              <span>${mediaPreview.length} mục</span>
            </div>
            <div class="media-grid">
              ${mediaPreview.map((item, index) => `<div class="media-tile">${renderAvatar(item)}${index % 2 ? "<b>▶</b>" : ""}</div>`).join("")}
            </div>
          </section>

        </section>
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

function getCallModeText(mode = "video") {
  return mode === "audio" ? "Cuộc gọi thoại" : "Cuộc gọi video";
}

function renderRemoteFrame(peer, index) {
  const user = peer.user || {};
  if (callState?.mode === "audio") {
    return `
      <div class="audio-frame">
        <audio data-remote-audio="${escapeAttr(user.id || index)}" autoplay></audio>
        <div class="call-avatar">${escapeHtml(user.avatar || initials(user.name || user.email || "?") || "?")}</div>
        <strong>${escapeHtml(user.name || "Thành viên")}</strong>
        <p>${escapeHtml(peer.status || "Đang kết nối âm thanh...")}</p>
      </div>
    `;
  }

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
    const modeText = getCallModeText(incomingCall.mode);
    const title = incomingCall.isGroup ? `${modeText} nhóm đến` : `${modeText} đến`;
    return `
      <div class="call-layer">
        <section class="call-panel compact">
          <div class="call-avatar">${escapeHtml(incomingCall.from.avatar)}</div>
          <h2>${escapeHtml(title)}</h2>
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
  const isAudioCall = callState.mode === "audio";
  const emptyText = isAudioCall ? "Đang chờ người nghe máy..." : "Đang chờ thành viên tham gia...";

  return `
    <div class="call-layer">
      <section class="call-panel ${isAudioCall ? "audio-call" : ""}">
        <header class="call-topbar">
          <div>
            <strong>${escapeHtml(callState.title || getCallModeText(callState.mode))}</strong>
            <span>${escapeHtml(callState.status || "Đang kết nối...")}</span>
          </div>
          <button class="call-icon-btn" id="minimizeCallBtn" title="Thu nhỏ">-</button>
        </header>
        <div class="video-grid ${peers.length > 1 ? "multi" : ""} ${isAudioCall ? "audio-mode" : ""}">
          <div class="remote-video-grid">
            ${peers.length ? peers.map(renderRemoteFrame).join("") : `
              <div class="video-frame remote">
                <div class="video-placeholder">
                  <div class="call-avatar">?</div>
                  <p>${emptyText}</p>
                </div>
              </div>
            `}
          </div>
          ${isAudioCall ? `
            <div class="audio-self">
              ${renderAvatar(currentUser)}
              <span>Bạn đang dùng micro</span>
            </div>
          ` : `
            <div class="video-frame local">
              <video id="localVideo" autoplay playsinline muted></video>
              <span>Bạn</span>
            </div>
          `}
        </div>
        <div class="call-actions">
          <button class="call-btn" id="toggleMicBtn">${callState.micEnabled ? "Tắt mic" : "Bật mic"}</button>
          ${isAudioCall ? "" : `<button class="call-btn" id="toggleCameraBtn">${callState.cameraEnabled ? "Tắt camera" : "Bật camera"}</button>`}
          ${isAudioCall ? "" : `<button class="call-btn" id="switchCameraBtn">Đổi camera</button>`}
          <button class="call-btn danger" id="endCallBtn">Kết thúc</button>
        </div>
      </section>
    </div>
  `;
}

function openTaskModal() {
  if (!getActiveConversation()) return showToast("Hãy chọn một cuộc trò chuyện trước khi giao việc.");
  modal = "task";
  renderApp();
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
  document.querySelectorAll("[data-group-options]").forEach((button) => {
    button.addEventListener("click", () => {
      modal = "groupOptions";
      renderApp();
    });
  });
  document.querySelectorAll("[data-unfriend]").forEach((button) => {
    button.addEventListener("click", () => unfriend(button.dataset.unfriend));
  });
  document.querySelectorAll("[data-leave-group]").forEach((button) => {
    button.addEventListener("click", () => leaveGroup(button.dataset.leaveGroup));
  });
  document.querySelectorAll("[data-delete-group]").forEach((button) => {
    button.addEventListener("click", () => deleteGroup(button.dataset.deleteGroup));
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
  $("#newStoryBtn")?.addEventListener("click", () => {
    storyDraftType = "story";
    modal = "story";
    renderApp();
  });
  $("#newStoryComposerBtn")?.addEventListener("click", () => {
    storyDraftType = "note";
    modal = "story";
    renderApp();
  });
  $("#newStoryPhotoBtn")?.addEventListener("click", () => {
    storyDraftType = "story";
    modal = "story";
    renderApp();
  });
  $("#newStoryVideoBtn")?.addEventListener("click", () => {
    storyDraftType = "story";
    modal = "story";
    renderApp();
  });
  $("#newTaskFromPanelBtn")?.addEventListener("click", openTaskModal);
  $("#settingsBtn")?.addEventListener("click", () => {
    modal = "settings";
    renderApp();
  });
  $("#railProfileBtn")?.addEventListener("click", () => {
    modal = "settings";
    renderApp();
  });
  $("#profileFriendsBtn")?.addEventListener("click", () => {
    modal = null;
    activeTab = "friends";
    mobileListOpen = true;
    renderApp();
  });
  $("#mobileBackBtn")?.addEventListener("click", () => {
    activeTab = "messages";
    mobileListOpen = true;
    renderApp();
  });
  $("#unpinBtn")?.addEventListener("click", unpinMessage);
  $("#audioCallBtn")?.addEventListener("click", () => startCall("audio"));
  $("#videoCallBtn")?.addEventListener("click", startVideoCall);
  document.querySelectorAll("[data-call-again]").forEach((button) => {
    button.addEventListener("click", () => startCall(button.dataset.callAgain || "audio"));
  });
  $("#acceptCallBtn")?.addEventListener("click", acceptIncomingCall);
  $("#rejectCallBtn")?.addEventListener("click", rejectIncomingCall);
  $("#endCallBtn")?.addEventListener("click", () => endCall(true));
  $("#toggleMicBtn")?.addEventListener("click", toggleMic);
  $("#toggleCameraBtn")?.addEventListener("click", toggleCamera);
  $("#switchCameraBtn")?.addEventListener("click", switchCamera);
  $("#minimizeCallBtn")?.addEventListener("click", () => showToast("Cuộc gọi đang hiển thị trên màn hình."));
  $("#logoutBtn")?.addEventListener("click", logout);
  $("#messageForm")?.addEventListener("submit", sendMessage);
  $("#groupForm")?.addEventListener("submit", createGroup);
  $("#taskForm")?.addEventListener("submit", createTask);
  $("#storyForm")?.addEventListener("submit", createStory);
  $("#groupOptionsForm")?.addEventListener("submit", saveGroupOptions);
  $("#settingsForm")?.addEventListener("submit", saveSettings);
  document.querySelectorAll('input[name="avatarFile"], input[name="coverFile"]').forEach((input) => {
    input.addEventListener("change", autoSaveProfileImage);
  });
  $("#installAppBtn")?.addEventListener("click", installApp);
  $("#settingsLogoutBtn")?.addEventListener("click", logout);
  $("#profileSettingsBackBtn")?.addEventListener("click", () => {
    $("#profileSettingsDetails")?.removeAttribute("open");
  });
  $("#clearGroupHistoryBtn")?.addEventListener("click", clearConversationHistory);
  $("#emojiBtn")?.addEventListener("click", () => {
    $("#iconTray")?.classList.toggle("hidden");
    $("#messageInput")?.focus();
  });
  document.querySelectorAll("[data-chat-icon]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = $("#messageInput");
      if (!input) return;
      const icon = button.dataset.chatIcon || "";
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = `${input.value.slice(0, start)}${icon}${input.value.slice(end)}`;
      input.focus();
      input.setSelectionRange(start + icon.length, start + icon.length);
    });
  });
  document.querySelectorAll("[data-delete-story]").forEach((button) => {
    button.addEventListener("click", () => deleteStory(button.dataset.deleteStory));
  });
  document.querySelectorAll("[data-copy-group-link]").forEach((button) => {
    button.addEventListener("click", async () => {
      const link = button.dataset.copyGroupLink || "";
      try {
        await navigator.clipboard.writeText(link);
        showToast("Đã sao chép link nhóm.");
      } catch {
        showToast(link);
      }
    });
  });
  document.querySelectorAll("[data-group-search], [data-group-calendar], [data-group-pins], [data-group-poll], [data-group-members], [data-group-notification], [data-group-personal], [data-group-report], [data-group-storage]").forEach((button) => {
    button.addEventListener("click", () => showToast("Chức năng này đang có giao diện demo."));
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

async function createStory(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const mediaFile = form.get("mediaFile");
  try {
    const mediaUrl = mediaFile instanceof File && mediaFile.size ? await prepareStoryMediaFile(mediaFile) : "";
    await api("/api/stories", {
      method: "POST",
      body: {
        type: form.get("type"),
        text: form.get("text"),
        mediaUrl
      }
    });
    modal = null;
    storyDraftType = "note";
    await refreshData({ keepMessages: true });
    renderApp();
    showToast("Đã đăng 24 giờ.");
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteStory(storyId) {
  if (!storyId) return;
  try {
    await api(`/api/stories/${storyId}`, { method: "DELETE" });
    await refreshData({ keepMessages: true });
    renderApp();
    showToast("Đã xóa story.");
  } catch (err) {
    showToast(err.message);
  }
}

async function saveGroupOptions(event) {
  event.preventDefault();
  const active = getActiveConversation();
  if (!active || active.type !== "group") return;
  const form = new FormData(event.currentTarget);
  const avatarFile = form.get("groupAvatarFile");
  const backgroundFile = form.get("groupBackgroundFile");
  const memberIds = form.getAll("memberIds");
  try {
    const avatarUrl = avatarFile instanceof File && avatarFile.size ? await resizeAvatarFile(avatarFile) : form.get("avatarUrl");
    const backgroundUrl = backgroundFile instanceof File && backgroundFile.size ? await resizeCoverFile(backgroundFile) : form.get("backgroundUrl");
    await api(`/api/groups/${active.id}`, {
      method: "PATCH",
      body: {
        name: form.get("name"),
        description: form.get("description"),
        avatarUrl,
        backgroundUrl
      }
    });
    if (memberIds.length) {
      await api(`/api/groups/${active.id}/members`, {
        method: "POST",
        body: { memberIds }
      });
    }
    modal = null;
    await refreshData();
    renderApp();
    showToast("Đã lưu tùy chọn nhóm.");
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

async function autoSaveProfileImage(event) {
  const form = event.currentTarget?.form;
  if (!form) return;
  await saveSettings(
    {
      preventDefault() {},
      currentTarget: form
    },
    { keepOpen: true, imageOnly: true }
  );
}

async function saveSettings(event, options = {}) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const avatarFile = form.get("avatarFile");
  const coverFile = form.get("coverFile");
  try {
    const avatarUrl = avatarFile instanceof File && avatarFile.size ? await resizeAvatarFile(avatarFile) : form.get("avatarUrl");
    const coverUrl = coverFile instanceof File && coverFile.size ? await resizeCoverFile(coverFile) : form.get("coverUrl");
    const data = await api("/api/me", {
      method: "PATCH",
      body: {
        name: form.get("name"),
        email: form.get("email"),
        avatarUrl,
        coverUrl,
        about: form.get("about"),
        birthday: form.get("birthday"),
        gender: form.get("gender"),
        hometown: form.get("hometown"),
        theme: form.get("theme")
      }
    });
    currentUser = data.user;
    localStorage.setItem("gmail-chat-theme", currentUser.theme || "light");
    if (!options.keepOpen) modal = null;
    await refreshData({ keepMessages: true });
    renderApp();
    showToast(options.imageOnly ? "Đã cập nhật ảnh." : "Đã lưu cài đặt.");
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

async function leaveGroup(groupId) {
  if (!groupId) return;
  if (!window.confirm("Bạn muốn rời khỏi nhóm này?")) return;
  try {
    await api(`/api/groups/${groupId}/leave`, { method: "POST" });
    if (activeConversationId === groupId) activeConversationId = "";
    activeTab = "groups";
    mobileListOpen = true;
    await refreshData();
    renderApp();
    showToast("Đã rời nhóm.");
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteGroup(groupId) {
  if (!groupId) return;
  if (!window.confirm("Xóa nhóm này cho tất cả thành viên? Tin nhắn và công việc trong nhóm sẽ bị xóa.")) return;
  try {
    await api(`/api/groups/${groupId}`, { method: "DELETE" });
    if (activeConversationId === groupId) activeConversationId = "";
    activeTab = "groups";
    mobileListOpen = true;
    await refreshData();
    renderApp();
    showToast("Đã xóa nhóm.");
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

async function clearConversationHistory() {
  const active = getActiveConversation();
  if (!active) return;
  if (!window.confirm("Xóa lịch sử trò chuyện trong cuộc trò chuyện này?")) return;
  try {
    await api(`/api/conversations/${active.id}/messages`, { method: "DELETE" });
    modal = null;
    await refreshData();
    renderApp();
    showToast("Đã xóa lịch sử trò chuyện.");
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
      showToast("Không gửi được tín hiệu kết nối cuộc gọi.");
    });
  };
  peerConnection.ontrack = (event) => {
    const peer = callState?.callId === callId ? callState.peers?.[remoteUser.id] : null;
    if (!peer) return;
    peer.remoteStream = event.streams[0] || peer.remoteStream || new MediaStream();
    if (!event.streams[0] && event.track) peer.remoteStream.addTrack(event.track);
    callState.connectedAt ||= Date.now();
    peer.status = "Đang trong cuộc gọi";
    callState.status = "Đang trong cuộc gọi";
    renderApp();
  };
  peerConnection.onconnectionstatechange = () => {
    const peer = callState?.callId === callId ? callState.peers?.[remoteUser.id] : null;
    if (!peer) return;
    if (peerConnection.connectionState === "connected") {
      callState.connectedAt ||= Date.now();
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
    { description: peer.peerConnection.localDescription, mode: callState.mode || "video" },
    callState.callId,
    remoteUser.id
  );
}

async function startCall(mode = "video") {
  const isAudioCall = mode === "audio";
  const active = getActiveConversation();
  if (!active) return showToast("Hãy chọn một cuộc trò chuyện để gọi.");
  if (callState || incomingCall) return showToast("Đang có một cuộc gọi khác.");
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    return showToast(`Trình duyệt này chưa hỗ trợ ${isAudioCall ? "gọi thoại" : "gọi video"}.`);
  }

  const remoteMembers = (active.members || []).filter((member) => member.id !== currentUser.id);
  if (!remoteMembers.length) return showToast("Cuộc trò chuyện này chưa có người khác để gọi.");

  const callId = makeCallId();
  let localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia(getCallMediaConstraints(isAudioCall, "user"));
    callState = {
      callId,
      conversationId: active.id,
      conversationType: active.type,
      hostId: currentUser.id,
      mode,
      title: active.type === "group"
        ? `${isAudioCall ? "Gọi thoại nhóm" : "Gọi video nhóm"} - ${active.peer.name}`
        : `${isAudioCall ? "Gọi thoại" : "Gọi video"} - ${remoteMembers[0]?.name || active.peer.name}`,
      peer: active.peer,
      localStream,
      peers: {},
      status: active.type === "group" ? "Đang gọi nhóm..." : "Đang gọi...",
      startedAt: Date.now(),
      connectedAt: 0,
      recorded: false,
      micEnabled: true,
      cameraEnabled: !isAudioCall,
      facingMode: isAudioCall ? "" : "user"
    };
    renderApp();
    showToast(callState.title);
    for (const member of remoteMembers) {
      await sendOfferToUser(member);
    }
  } catch (err) {
    localStream?.getTracks().forEach((track) => track.stop());
    cleanupCall();
    const permissionText = isAudioCall ? "Bạn cần cho phép micro." : "Bạn cần cho phép camera và micro.";
    const errorText = isAudioCall ? "Không bắt đầu được cuộc gọi thoại." : "Không bắt đầu được cuộc gọi video.";
    showToast(err.name === "NotAllowedError" ? permissionText : errorText);
  }
}

async function startVideoCall() {
  return startCall("video");
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
        mode: signal.payload.mode || "video",
        from: signal.from,
        offers: {},
        pendingCandidates: {}
      };
      startRingtone();
      const callKind = incomingCall.mode === "audio" ? "cuộc gọi thoại" : "cuộc gọi video";
      showToast(`${signal.from.name} đang gọi ${callKind}.`);
      showDeviceNotification("Có cuộc gọi đến", `${signal.from.name} đang gọi ${callKind}.`);
    }
    incomingCall.mode = incomingCall.mode || signal.payload.mode || "video";
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
    if (!getCallPeers().length || callState.conversationType !== "group") {
      const previous = callState;
      cleanupCall();
      renderApp();
      await recordCallHistory(previous);
      return;
    }
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
  const isAudioCall = pending.mode === "audio";

  let localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia(getCallMediaConstraints(isAudioCall, "user"));
    callState = {
      callId: pending.callId,
      conversationId: pending.conversationId,
      conversationType: pending.isGroup ? "group" : "direct",
      hostId: pending.from.id,
      mode: pending.mode || "video",
      title: pending.isGroup
        ? `${isAudioCall ? "Gọi thoại nhóm" : "Gọi video nhóm"} - ${pending.conversationName}`
        : `${isAudioCall ? "Gọi thoại" : "Gọi video"} - ${pending.from.name}`,
      peer: pending.from,
      localStream,
      peers: {},
      status: "Đang kết nối...",
      startedAt: Date.now(),
      connectedAt: 0,
      recorded: false,
      micEnabled: true,
      cameraEnabled: !isAudioCall,
      facingMode: isAudioCall ? "" : "user"
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
    const permissionText = isAudioCall ? "Bạn cần cho phép micro." : "Bạn cần cho phép camera và micro.";
    showToast(err.name === "NotAllowedError" ? permissionText : "Không nhận được cuộc gọi.");
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

async function switchCamera() {
  if (!callState?.localStream || callState.mode === "audio") return;
  const nextFacingMode = callState.facingMode === "environment" ? "user" : "environment";
  let nextStream;

  try {
    nextStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: nextFacingMode } } });
    const nextTrack = nextStream.getVideoTracks()[0];
    if (!nextTrack) throw new Error("Không tìm thấy camera khác.");

    const previousVideoTrack = callState.localStream.getVideoTracks()[0];
    nextTrack.enabled = callState.cameraEnabled;
    if (previousVideoTrack) {
      callState.localStream.removeTrack(previousVideoTrack);
      previousVideoTrack.stop();
    }
    callState.localStream.addTrack(nextTrack);

    await Promise.all(Object.values(callState.peers || {}).map(async (peer) => {
      const sender = peer.peerConnection
        ?.getSenders()
        .find((item) => item.track?.kind === "video");
      if (sender) await sender.replaceTrack(nextTrack);
      else peer.peerConnection?.addTrack(nextTrack, callState.localStream);
    }));

    callState.facingMode = nextFacingMode;
    renderApp();
    attachCallStreams();
    showToast(nextFacingMode === "environment" ? "Đã chuyển sang camera sau." : "Đã chuyển sang camera trước.");
  } catch {
    nextStream?.getTracks().forEach((track) => track.stop());
    showToast("Thiết bị này chưa đổi được camera trong cuộc gọi.");
  }
}

async function endCall(shouldSignal) {
  const previous = callState;
  if (shouldSignal && previous) await sendCallSignal(previous.conversationId, "hangup", {}, previous.callId).catch(() => {});
  cleanupCall();
  renderApp();
  await recordCallHistory(previous);
}

async function recordCallHistory(previous) {
  if (!previous || previous.recorded || !previous.conversationId || !previous.callId) return;
  previous.recorded = true;
  const endedAt = Date.now();
  const startedAt = previous.connectedAt || previous.startedAt || endedAt;
  const durationSeconds = previous.connectedAt ? Math.max(0, Math.round((endedAt - startedAt) / 1000)) : 0;
  try {
    await api(`/api/conversations/${previous.conversationId}/call-record`, {
      method: "POST",
      body: {
        callId: previous.callId,
        mode: previous.mode || "audio",
        startedBy: previous.hostId || currentUser.id,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        durationSeconds
      }
    });
    await refreshData({ keepMessages: true });
    if (activeConversationId) await loadMessages(activeConversationId);
    renderApp();
    showDeviceNotification("Cuộc gọi đã kết thúc", `${previous.title || "Cuộc gọi"} - ${formatCallDuration(durationSeconds)}`);
  } catch {
    showToast("Chưa ghi được lịch sử cuộc gọi.");
  }
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
  document.querySelectorAll("[data-remote-audio]").forEach((audio) => {
    const peer = callState.peers?.[audio.dataset.remoteAudio];
    if (peer?.remoteStream && audio.srcObject !== peer.remoteStream) audio.srcObject = peer.remoteStream;
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
  window.addEventListener(eventName, unlockInteractions, { passive: true });
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
