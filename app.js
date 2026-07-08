const tokenKey = "gmail-chat-token";

let token = localStorage.getItem(tokenKey) || "";
let currentUser = null;
let conversations = [];
let requests = [];
let messages = [];
let activeConversationId = "";
let authMode = "login";
let activeTab = "messages";
let searchText = "";
let searchResults = [];
let events = null;

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
  if (!response.ok) {
    throw new Error(data.error || "Co loi xay ra.");
  }
  return data;
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2600);
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

  if (!conversations.some((item) => item.id === activeConversationId)) {
    activeConversationId = conversations[0]?.id || "";
  }

  if (activeConversationId && !keepMessages) {
    await loadMessages(activeConversationId);
  }
}

async function loadMessages(conversationId) {
  if (!conversationId) {
    messages = [];
    return;
  }

  const data = await api(`/api/conversations/${conversationId}/messages`);
  messages = data.messages || [];
}

function connectEvents() {
  if (events) events.close();
  events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  events.addEventListener("refresh", async () => {
    const previous = activeConversationId;
    await refreshData({ keepMessages: true });
    if (previous && conversations.some((item) => item.id === previous)) {
      activeConversationId = previous;
    }
    await loadMessages(activeConversationId);
    renderApp();
  });
}

function renderAuth() {
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
          Tai khoan thu: <strong>demo1@gmail.com</strong> / <strong>123456</strong>
          va <strong>demo2@gmail.com</strong> / <strong>123456</strong>.
          Mo hai trinh duyet de thu chat realtime.
        </p>
      </section>

      <section class="preview" aria-hidden="true">
        <div class="phone-preview">
          <div class="phone-screen">
            <div class="preview-top">
              <strong>Chat realtime</strong>
              <span>Tim Gmail, ket ban, nhan tin ngay</span>
            </div>
            <div class="preview-list">
              ${["Tim ban bang Gmail", "Gui loi moi ket ban", "Chat truc tuyen", "Luu lich su tren server"]
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

  if (!isGmail(email)) {
    error.textContent = "Vui long dung dia chi @gmail.com.";
    return;
  }

  if (password.length < 6) {
    error.textContent = "Mat khau can toi thieu 6 ky tu.";
    return;
  }

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
  const active = conversations.find((item) => item.id === activeConversationId);
  $("#app").innerHTML = `
    <main class="app-shell">
      <nav class="rail" aria-label="Dieu huong">
        <div class="avatar">${escapeHtml(currentUser.avatar || initials(currentUser.name))}</div>
        <button class="icon-btn active" title="Tin nhan">C</button>
        <button class="icon-btn" title="Danh ba">F</button>
        <button class="icon-btn" title="Thong bao">${requests.length || "N"}</button>
        <div class="rail-spacer"></div>
        <button class="icon-btn" id="logoutBtn" title="Dang xuat">X</button>
      </nav>

      <aside class="sidebar">
        <div class="search-zone">
          <label class="search-box">
            <span>@</span>
            <input id="searchInput" value="${escapeHtml(searchText)}" placeholder="Nhap Gmail de tim ban">
          </label>
          <div class="quick-actions">
            <button class="small-btn" id="searchBtn">Tim Gmail</button>
            <button class="small-btn" id="refreshBtn">Lam moi</button>
          </div>
        </div>

        <div class="section-tabs">
          <button class="${activeTab === "messages" ? "active" : ""}" data-tab="messages">Tin nhan</button>
          <button class="${activeTab === "contacts" ? "active" : ""}" data-tab="contacts">Tim ban</button>
          <button class="${activeTab === "requests" ? "active" : ""}" data-tab="requests">Loi moi ${requests.length ? `(${requests.length})` : ""}</button>
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
  `;

  bindAppEvents();
  scrollMessagesToBottom();
}

function renderSidebarList() {
  if (activeTab === "contacts") {
    if (!searchResults.length) {
      return `<div class="empty-state">Nhap Gmail roi bam Tim Gmail de gui loi moi ket ban.</div>`;
    }

    return searchResults
      .map(
        (user) => `
          <div class="contact-row padded">
            <div class="avatar">${escapeHtml(user.avatar)}</div>
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

  if (activeTab === "requests") {
    if (!requests.length) {
      return `<div class="empty-state">Chua co loi moi ket ban nao.</div>`;
    }

    return requests
      .map(
        (request) => `
          <div class="contact-row padded">
            <div class="avatar orange">${escapeHtml(request.from.avatar)}</div>
            <div>
              <strong>${escapeHtml(request.from.name)}</strong>
              <p>${escapeHtml(request.from.email)}</p>
            </div>
            <button class="mini-action" data-accept="${escapeHtml(request.id)}">Nhan</button>
          </div>
        `
      )
      .join("");
  }

  const query = searchText.trim().toLowerCase();
  const list = conversations.filter((item) => {
    const haystack = `${item.peer.name} ${item.peer.email} ${item.lastMessage?.text || ""}`.toLowerCase();
    return haystack.includes(query);
  });

  if (!list.length) {
    return `<div class="empty-state">Chua co ban be. Hay tim Gmail cua nguoi khac de ket ban.</div>`;
  }

  return list
    .map((item) => {
      const last = item.lastMessage;
      return `
        <button class="conversation ${item.id === activeConversationId ? "active" : ""}" data-conversation="${escapeHtml(item.id)}">
          <div class="avatar">${escapeHtml(item.peer.avatar)}</div>
          <div>
            <strong>${escapeHtml(item.peer.name)}</strong>
            <p>${escapeHtml(last ? last.text : item.peer.email)}</p>
          </div>
          <div>
            <span class="time">${escapeHtml(formatTime(last?.createdAt))}</span>
          </div>
        </button>
      `;
    })
    .join("");
}

function renderFriendAction(user) {
  if (user.status === "friend") return `<span class="status-label">Ban be</span>`;
  if (user.status === "requested") return `<span class="status-label">Da gui</span>`;
  if (user.status === "incoming") return `<span class="status-label">Cho nhan</span>`;
  return `<button class="mini-action" data-add-friend="${escapeHtml(user.email)}">Ket ban</button>`;
}

function renderChat(active) {
  return `
    <header class="chat-header">
      <div class="person">
        <div class="avatar">${escapeHtml(active.peer.avatar)}</div>
        <div>
          <strong>${escapeHtml(active.peer.name)}</strong>
          <span>${escapeHtml(active.peer.email)} · dang san sang chat</span>
        </div>
      </div>
      <div class="header-actions">
        <button title="Lam moi" id="headerRefreshBtn">R</button>
      </div>
    </header>

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

function renderEmptyChat() {
  return `
    <div class="empty-chat">
      <h2>Bat dau bang Gmail</h2>
      <p>Tim tai khoan Gmail cua nguoi khac, gui loi moi ket ban, roi chat truc tuyen khi ho chap nhan.</p>
    </div>
  `;
}

function renderDetails(active) {
  return `
    <div class="details-cover"></div>
    <div class="details-profile">
      <div class="avatar">${escapeHtml(active.peer.avatar)}</div>
      <h2>${escapeHtml(active.peer.name)}</h2>
      <p>${escapeHtml(active.peer.email)}</p>
    </div>
    <div class="detail-block">
      <h3>Tai khoan cua ban</h3>
      <div class="contact-row">
        <div class="avatar">${escapeHtml(currentUser.avatar)}</div>
        <div>
          <strong>${escapeHtml(currentUser.name)}</strong>
          <p>${escapeHtml(currentUser.email)}</p>
        </div>
      </div>
    </div>
    <div class="detail-block">
      <h3>Realtime</h3>
      <p class="detail-copy">Tin nhan va loi moi ket ban duoc dong bo qua server Node dang chay tren may nay.</p>
    </div>
  `;
}

function renderAccountDetails() {
  return `
    <div class="details-cover"></div>
    <div class="details-profile">
      <div class="avatar">${escapeHtml(currentUser.avatar)}</div>
      <h2>${escapeHtml(currentUser.name)}</h2>
      <p>${escapeHtml(currentUser.email)}</p>
    </div>
  `;
}

function renderMessage(message) {
  const isMe = message.senderId === currentUser.id;
  return `
    <div class="message ${isMe ? "me" : ""}">
      <div class="avatar">${escapeHtml(message.sender?.avatar || "?")}</div>
      <div class="bubble">
        <p>${escapeHtml(message.text)}</p>
        <time>${escapeHtml(formatTime(message.createdAt))}</time>
      </div>
    </div>
  `;
}

function bindAppEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.tab;
      renderApp();
    });
  });

  document.querySelectorAll("[data-conversation]").forEach((button) => {
    button.addEventListener("click", async () => {
      activeConversationId = button.dataset.conversation;
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
  $("#refreshBtn")?.addEventListener("click", manualRefresh);
  $("#headerRefreshBtn")?.addEventListener("click", manualRefresh);
  $("#logoutBtn")?.addEventListener("click", logout);
  $("#messageForm")?.addEventListener("submit", sendMessage);
  $("#emojiBtn")?.addEventListener("click", () => {
    const input = $("#messageInput");
    input.value = `${input.value} :)`.trimStart();
    input.focus();
  });
}

async function searchUsers() {
  const email = searchText.trim().toLowerCase();
  if (!email) {
    showToast("Nhap Gmail can tim.");
    return;
  }

  activeTab = "contacts";
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
    await api("/api/friend-requests", {
      method: "POST",
      body: { email }
    });
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
    const data = await api(`/api/friend-requests/${requestId}/accept`, {
      method: "POST"
    });
    activeConversationId = data.conversation.id;
    activeTab = "messages";
    await refreshData();
    renderApp();
    showToast("Da chap nhan ket ban.");
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
    await api(`/api/conversations/${activeConversationId}/messages`, {
      method: "POST",
      body: { text }
    });
    await refreshData();
    renderApp();
  } catch (err) {
    input.value = text;
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

function logout() {
  if (events) events.close();
  events = null;
  token = "";
  currentUser = null;
  conversations = [];
  requests = [];
  messages = [];
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
