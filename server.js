const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const dataDir = process.env.DATA_DIR || root;
const dbPath = path.join(dataDir, "chat-db.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

const sessions = new Map();
const eventClients = new Map();

let db = loadDb();

function loadDb() {
  if (!fs.existsSync(dbPath)) return createDb();

  try {
    return normalizeDb(JSON.parse(fs.readFileSync(dbPath, "utf8")));
  } catch {
    return createDb();
  }
}

function normalizeDb(data) {
  const next = {
    users: Array.isArray(data.users) ? data.users : [],
    friendRequests: Array.isArray(data.friendRequests) ? data.friendRequests : [],
    conversations: Array.isArray(data.conversations) ? data.conversations : [],
    messages: Array.isArray(data.messages) ? data.messages : [],
    tasks: Array.isArray(data.tasks) ? data.tasks : []
  };

  next.users.forEach((user) => {
    user.name ||= user.email?.split("@")[0] || "User";
    user.avatarUrl ||= "";
    user.theme ||= "light";
    user.about ||= "";
    user.createdAt ||= new Date().toISOString();
  });

  next.conversations.forEach((conversation) => {
    conversation.type ||= "direct";
    conversation.participantIds ||= [];
    conversation.createdAt ||= new Date().toISOString();
    conversation.createdBy ||= conversation.participantIds[0] || "";
    conversation.pinnedMessageId ||= "";
    if (conversation.type === "group") {
      conversation.name ||= "Nhóm chat";
      conversation.avatarUrl ||= "";
    }
  });

  next.messages.forEach((message) => {
    message.type ||= "text";
    message.createdAt ||= new Date().toISOString();
  });

  next.tasks.forEach((task) => {
    task.status ||= "open";
    task.createdAt ||= new Date().toISOString();
  });

  ensureDemoUser(next, "Demo One", "demo1@gmail.com");
  ensureDemoUser(next, "Demo Two", "demo2@gmail.com");
  ensureDemoUser(next, "Demo Three", "demo3@gmail.com");
  ensureDemoFriendTriangle(next);
  return next;
}

function ensureDemoUser(targetDb, name, email) {
  if (targetDb.users.some((user) => user.email === email)) return;
  targetDb.users.push(createUser(name, email, "123456"));
}

function ensureDemoFriendTriangle(targetDb) {
  const demoUsers = ["demo1@gmail.com", "demo2@gmail.com", "demo3@gmail.com"]
    .map((email) => targetDb.users.find((user) => user.email === email))
    .filter(Boolean);
  if (demoUsers.length < 3) return;

  for (let i = 0; i < demoUsers.length; i += 1) {
    for (let j = i + 1; j < demoUsers.length; j += 1) {
      const userA = demoUsers[i];
      const userB = demoUsers[j];
      const exists = targetDb.conversations.some(
        (conversation) =>
          conversation.type === "direct" &&
          conversation.participantIds.includes(userA.id) &&
          conversation.participantIds.includes(userB.id)
      );
      if (exists) continue;

      const conversationId = createId("conv");
      const now = new Date().toISOString();
      targetDb.conversations.push({
        id: conversationId,
        type: "direct",
        participantIds: [userA.id, userB.id],
        createdBy: userA.id,
        pinnedMessageId: "",
        createdAt: now
      });
      targetDb.messages.push({
        id: createId("msg"),
        conversationId,
        senderId: userA.id,
        text: "Chào bạn, đây là phòng chat realtime demo.",
        type: "text",
        createdAt: now
      });
    }
  }
}

function createDb() {
  return normalizeDb({
    users: [],
    friendRequests: [],
    conversations: [],
    messages: [],
    tasks: []
  });
}

function saveDb() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString("hex")}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

function createUser(name, email, password) {
  return {
    id: createId("user"),
    name,
    email: email.toLowerCase(),
    avatarUrl: "",
    theme: "light",
    about: "",
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };
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

function isGmail(email) {
  return /^[^\s@]+@gmail\.com$/i.test(email);
}

function publicUser(user) {
  if (!user) return { id: "", name: "Unknown", email: "", avatar: "?", avatarUrl: "", about: "" };
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: initials(user.name || user.email),
    avatarUrl: user.avatarUrl || "",
    about: user.about || ""
  };
}

function privateUser(user) {
  return {
    ...publicUser(user),
    theme: user.theme || "light",
    friendCount: getFriendsFor(user.id).length
  };
}

function publicConversation(conversation, userId) {
  const messages = db.messages
    .filter((message) => message.conversationId === conversation.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const lastMessage = messages[messages.length - 1] || null;
  const pinnedMessage = conversation.pinnedMessageId
    ? db.messages.find((message) => message.id === conversation.pinnedMessageId)
    : null;
  const tasks = db.tasks.filter((task) => task.conversationId === conversation.id);

  if (conversation.type === "group") {
    const members = conversation.participantIds
      .map((id) => db.users.find((user) => user.id === id))
      .filter(Boolean)
      .map(publicUser);
    return {
      id: conversation.id,
      type: "group",
      name: conversation.name,
      peer: {
        id: conversation.id,
        name: conversation.name,
        email: `${members.length} thành viên`,
        avatar: initials(conversation.name),
        avatarUrl: conversation.avatarUrl || ""
      },
      members,
      lastMessage,
      pinnedMessage,
      taskSummary: {
        total: tasks.length,
        open: tasks.filter((task) => task.status !== "done").length
      },
      updatedAt: lastMessage?.createdAt || conversation.createdAt,
      messageCount: messages.length
    };
  }

  const otherId = conversation.participantIds.find((id) => id !== userId);
  const other = db.users.find((user) => user.id === otherId) || db.users.find((user) => user.id === userId);
  return {
    id: conversation.id,
    type: "direct",
    peer: publicUser(other),
    members: conversation.participantIds
      .map((id) => db.users.find((user) => user.id === id))
      .filter(Boolean)
      .map(publicUser),
    lastMessage,
    pinnedMessage,
    taskSummary: {
      total: tasks.length,
      open: tasks.filter((task) => task.status !== "done").length
    },
    updatedAt: lastMessage?.createdAt || conversation.createdAt,
    messageCount: messages.length
  };
}

function findUserByEmail(email) {
  return db.users.find((user) => user.email === String(email).toLowerCase());
}

function findSession(req) {
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const token = bearer || new URL(req.url, `http://${req.headers.host}`).searchParams.get("token");
  if (!token) return null;
  const userId = sessions.get(token);
  const user = db.users.find((candidate) => candidate.id === userId);
  return user ? { token, user } : null;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function requireAuth(req, res) {
  const session = findSession(req);
  if (!session) {
    sendJson(res, 401, { error: "Cần đăng nhập." });
    return null;
  }
  return session;
}

function findDirectConversation(userA, userB) {
  return db.conversations.find(
    (conversation) =>
      conversation.type === "direct" &&
      conversation.participantIds.includes(userA) &&
      conversation.participantIds.includes(userB)
  );
}

function areFriends(userA, userB) {
  return Boolean(findDirectConversation(userA, userB));
}

function friendStatus(currentUserId, targetUserId) {
  if (currentUserId === targetUserId) return "self";
  if (areFriends(currentUserId, targetUserId)) return "friend";

  const outgoing = db.friendRequests.find(
    (request) => request.fromUserId === currentUserId && request.toUserId === targetUserId && request.status === "pending"
  );
  if (outgoing) return "requested";

  const incoming = db.friendRequests.find(
    (request) => request.fromUserId === targetUserId && request.toUserId === currentUserId && request.status === "pending"
  );
  if (incoming) return "incoming";

  return "none";
}

function getFriendsFor(userId) {
  return db.conversations
    .filter((conversation) => conversation.type === "direct" && conversation.participantIds.includes(userId))
    .map((conversation) => conversation.participantIds.find((id) => id !== userId))
    .map((id) => db.users.find((user) => user.id === id))
    .filter(Boolean)
    .map((user) => ({
      ...publicUser(user),
      conversationId: findDirectConversation(userId, user.id)?.id || ""
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getConversationsFor(userId) {
  return db.conversations
    .filter((conversation) => conversation.participantIds.includes(userId))
    .map((conversation) => publicConversation(conversation, userId))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getMessagesFor(userId, conversationId) {
  const conversation = db.conversations.find((item) => item.id === conversationId);
  if (!conversation || !conversation.participantIds.includes(userId)) return null;

  return db.messages
    .filter((message) => message.conversationId === conversationId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((message) => ({
      ...message,
      isPinned: conversation.pinnedMessageId === message.id,
      sender: publicUser(db.users.find((user) => user.id === message.senderId))
    }));
}

function getTasksForConversation(userId, conversationId) {
  const conversation = db.conversations.find((item) => item.id === conversationId);
  if (!conversation || !conversation.participantIds.includes(userId)) return null;

  return db.tasks
    .filter((task) => task.conversationId === conversationId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(publicTask);
}

function getTasksForUser(userId) {
  const visibleConversationIds = new Set(
    db.conversations.filter((conversation) => conversation.participantIds.includes(userId)).map((conversation) => conversation.id)
  );
  return db.tasks
    .filter((task) => visibleConversationIds.has(task.conversationId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(publicTask);
}

function publicTask(task) {
  const conversation = db.conversations.find((item) => item.id === task.conversationId);
  const assignee = db.users.find((user) => user.id === task.assigneeId);
  const creator = db.users.find((user) => user.id === task.createdBy);
  return {
    ...task,
    conversationName: conversation?.type === "group" ? conversation.name : "Tin nhắn riêng",
    assignee: publicUser(assignee),
    creator: publicUser(creator)
  };
}

function getRequestsFor(userId) {
  return db.friendRequests
    .filter((request) => request.toUserId === userId && request.status === "pending")
    .map((request) => ({
      id: request.id,
      createdAt: request.createdAt,
      from: publicUser(db.users.find((user) => user.id === request.fromUserId))
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function pushEvent(userIds, eventName, payload = {}) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  uniqueIds.forEach((userId) => {
    const clients = eventClients.get(userId) || new Set();
    clients.forEach((res) => {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    });
  });
}

function pushConversationRefresh(conversation, reason, actorId = "") {
  pushEvent(conversation.participantIds, "refresh", { reason, conversationId: conversation.id, actorId });
}

function canSeeProfile(viewerId, targetId) {
  if (viewerId === targetId) return true;
  if (areFriends(viewerId, targetId)) return true;
  return db.conversations.some(
    (conversation) =>
      conversation.type === "group" &&
      conversation.participantIds.includes(viewerId) &&
      conversation.participantIds.includes(targetId)
  );
}

function validateAvatarUrl(value) {
  const avatarUrl = String(value || "").trim();
  if (!avatarUrl) return "";
  if (avatarUrl.length > 900_000) throw new Error("Ảnh đại diện quá lớn. Vui lòng chọn ảnh nhỏ hơn.");
  if (!/^https?:\/\//i.test(avatarUrl) && !avatarUrl.startsWith("data:image/")) {
    throw new Error("Ảnh đại diện cần là URL http/https hoặc data image.");
  }
  return avatarUrl;
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "POST" && url.pathname === "/api/register") {
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");

      if (!name) return sendJson(res, 400, { error: "Vui lòng nhập tên hiển thị." });
      if (!isGmail(email)) return sendJson(res, 400, { error: "Chỉ chấp nhận địa chỉ @gmail.com." });
      if (password.length < 6) return sendJson(res, 400, { error: "Mật khẩu cần tối thiểu 6 ký tự." });
      if (findUserByEmail(email)) return sendJson(res, 409, { error: "Gmail này đã được đăng ký." });

      const user = createUser(name, email, password);
      db.users.push(user);
      saveDb();
      const token = createId("session");
      sessions.set(token, user.id);
      return sendJson(res, 201, { token, user: privateUser(user) });
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readJson(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = findUserByEmail(email);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return sendJson(res, 401, { error: "Sai Gmail hoặc mật khẩu." });
      }

      const token = createId("session");
      sessions.set(token, user.id);
      return sendJson(res, 200, { token, user: privateUser(user) });
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      const session = requireAuth(req, res);
      if (!session) return;
      return sendJson(res, 200, {
        user: privateUser(session.user),
        conversations: getConversationsFor(session.user.id),
        requests: getRequestsFor(session.user.id),
        friends: getFriendsFor(session.user.id),
        tasks: getTasksForUser(session.user.id)
      });
    }

    if (req.method === "PATCH" && url.pathname === "/api/me") {
      const session = requireAuth(req, res);
      if (!session) return;
      const body = await readJson(req);
      const name = String(body.name ?? session.user.name).trim();
      if (!name) return sendJson(res, 400, { error: "Tên hiển thị không được rỗng." });

      let avatarUrl = session.user.avatarUrl || "";
      try {
        avatarUrl = validateAvatarUrl(body.avatarUrl ?? session.user.avatarUrl);
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }

      const theme = ["light", "dark", "system"].includes(body.theme) ? body.theme : session.user.theme || "light";
      session.user.name = name.slice(0, 80);
      session.user.about = String(body.about ?? session.user.about ?? "").trim().slice(0, 160);
      session.user.avatarUrl = avatarUrl;
      session.user.theme = theme;
      saveDb();

      const relatedUserIds = db.conversations
        .filter((conversation) => conversation.participantIds.includes(session.user.id))
        .flatMap((conversation) => conversation.participantIds);
      pushEvent(relatedUserIds, "refresh", { reason: "profile-updated", actorId: session.user.id });
      return sendJson(res, 200, { user: privateUser(session.user) });
    }

    if (req.method === "GET" && url.pathname === "/api/friends") {
      const session = requireAuth(req, res);
      if (!session) return;
      return sendJson(res, 200, { friends: getFriendsFor(session.user.id) });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/friends/")) {
      const session = requireAuth(req, res);
      if (!session) return;
      const targetId = decodeURIComponent(url.pathname.split("/")[3] || "");
      const direct = findDirectConversation(session.user.id, targetId);
      if (!direct) return sendJson(res, 404, { error: "Hai tài khoản chưa kết bạn." });

      db.conversations = db.conversations.filter((conversation) => conversation.id !== direct.id);
      db.messages = db.messages.filter((message) => message.conversationId !== direct.id);
      db.tasks = db.tasks.filter((task) => task.conversationId !== direct.id);
      saveDb();
      pushEvent(direct.participantIds, "refresh", { reason: "unfriended", actorId: session.user.id });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/users/") && url.pathname.endsWith("/profile")) {
      const session = requireAuth(req, res);
      if (!session) return;
      const userId = decodeURIComponent(url.pathname.split("/")[3] || "");
      const user = db.users.find((candidate) => candidate.id === userId);
      if (!user || !canSeeProfile(session.user.id, user.id)) {
        return sendJson(res, 404, { error: "Không xem được hồ sơ này." });
      }
      return sendJson(res, 200, {
        profile: {
          ...publicUser(user),
          friendStatus: friendStatus(session.user.id, user.id),
          friendCount: getFriendsFor(user.id).length,
          groupsInCommon: db.conversations.filter(
            (conversation) =>
              conversation.type === "group" &&
              conversation.participantIds.includes(session.user.id) &&
              conversation.participantIds.includes(user.id)
          ).length
        }
      });
    }

    if (req.method === "GET" && url.pathname === "/api/search") {
      const session = requireAuth(req, res);
      if (!session) return;
      const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
      if (!email) return sendJson(res, 200, { users: [] });

      const users = db.users
        .filter((user) => user.email.includes(email) && user.id !== session.user.id)
        .slice(0, 10)
        .map((user) => ({
          ...publicUser(user),
          status: friendStatus(session.user.id, user.id)
        }));

      return sendJson(res, 200, { users });
    }

    if (req.method === "POST" && url.pathname === "/api/friend-requests") {
      const session = requireAuth(req, res);
      if (!session) return;
      const body = await readJson(req);
      const email = String(body.email || "").trim().toLowerCase();
      const target = findUserByEmail(email);

      if (!target) return sendJson(res, 404, { error: "Không tìm thấy tài khoản Gmail này." });
      if (target.id === session.user.id) return sendJson(res, 400, { error: "Không thể kết bạn với chính mình." });
      if (areFriends(session.user.id, target.id)) return sendJson(res, 409, { error: "Hai tài khoản đã là bạn bè." });

      const incoming = db.friendRequests.find(
        (request) => request.fromUserId === target.id && request.toUserId === session.user.id && request.status === "pending"
      );
      if (incoming) return acceptRequest(session.user, incoming, res);

      const existing = db.friendRequests.find(
        (request) => request.fromUserId === session.user.id && request.toUserId === target.id && request.status === "pending"
      );
      if (existing) return sendJson(res, 409, { error: "Lời mời kết bạn đã được gửi trước đó." });

      const request = {
        id: createId("req"),
        fromUserId: session.user.id,
        toUserId: target.id,
        status: "pending",
        createdAt: new Date().toISOString()
      };
      db.friendRequests.push(request);
      saveDb();
      pushEvent([target.id], "refresh", { reason: "friend-request", actorId: session.user.id });
      return sendJson(res, 201, { request });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/friend-requests/") && url.pathname.endsWith("/accept")) {
      const session = requireAuth(req, res);
      if (!session) return;
      const requestId = url.pathname.split("/")[3];
      const request = db.friendRequests.find(
        (candidate) => candidate.id === requestId && candidate.toUserId === session.user.id && candidate.status === "pending"
      );
      if (!request) return sendJson(res, 404, { error: "Không tìm thấy lời mời kết bạn." });
      return acceptRequest(session.user, request, res);
    }

    if (req.method === "POST" && url.pathname === "/api/groups") {
      const session = requireAuth(req, res);
      if (!session) return;
      const body = await readJson(req);
      const name = String(body.name || "").trim().slice(0, 80);
      const memberIds = [...new Set(Array.isArray(body.memberIds) ? body.memberIds.map(String) : [])].filter(
        (id) => id !== session.user.id
      );
      const participantIds = [session.user.id, ...memberIds];

      if (!name) return sendJson(res, 400, { error: "Vui lòng đặt tên nhóm." });
      if (participantIds.length < 3) return sendJson(res, 400, { error: "Nhóm cần ít nhất 3 người." });
      if (participantIds.some((id) => !db.users.some((user) => user.id === id))) {
        return sendJson(res, 400, { error: "Thành viên không hợp lệ." });
      }
      for (let i = 0; i < participantIds.length; i += 1) {
        for (let j = i + 1; j < participantIds.length; j += 1) {
          if (!areFriends(participantIds[i], participantIds[j])) {
            return sendJson(res, 400, { error: "Tất cả thành viên cần kết bạn với nhau trước khi tạo nhóm." });
          }
        }
      }

      let avatarUrl = "";
      try {
        avatarUrl = validateAvatarUrl(body.avatarUrl || "");
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }

      const conversation = {
        id: createId("conv"),
        type: "group",
        name,
        avatarUrl,
        participantIds,
        createdBy: session.user.id,
        pinnedMessageId: "",
        createdAt: new Date().toISOString()
      };
      db.conversations.push(conversation);
      db.messages.push({
        id: createId("msg"),
        conversationId: conversation.id,
        senderId: session.user.id,
        text: `Đã tạo nhóm ${name}.`,
        type: "system",
        createdAt: new Date().toISOString()
      });
      saveDb();
      pushConversationRefresh(conversation, "group-created", session.user.id);
      return sendJson(res, 201, { conversation: publicConversation(conversation, session.user.id) });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/conversations/") && url.pathname.endsWith("/messages")) {
      const session = requireAuth(req, res);
      if (!session) return;
      const conversationId = url.pathname.split("/")[3];
      const messages = getMessagesFor(session.user.id, conversationId);
      if (!messages) return sendJson(res, 404, { error: "Không tìm thấy cuộc trò chuyện." });
      const tasks = getTasksForConversation(session.user.id, conversationId) || [];
      return sendJson(res, 200, { messages, tasks });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/conversations/") && url.pathname.endsWith("/messages")) {
      const session = requireAuth(req, res);
      if (!session) return;
      const conversationId = url.pathname.split("/")[3];
      const conversation = db.conversations.find((item) => item.id === conversationId);
      if (!conversation || !conversation.participantIds.includes(session.user.id)) {
        return sendJson(res, 404, { error: "Không tìm thấy cuộc trò chuyện." });
      }

      const body = await readJson(req);
      const text = String(body.text || "").trim();
      if (!text) return sendJson(res, 400, { error: "Tin nhắn dang rong." });
      if (text.length > 2000) return sendJson(res, 400, { error: "Tin nhắn quá dài." });

      const message = {
        id: createId("msg"),
        conversationId,
        senderId: session.user.id,
        text,
        type: "text",
        createdAt: new Date().toISOString()
      };
      db.messages.push(message);
      saveDb();
      pushConversationRefresh(conversation, "message", session.user.id);
      return sendJson(res, 201, { message: { ...message, sender: publicUser(session.user) } });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/conversations/") && url.pathname.endsWith("/pin")) {
      const session = requireAuth(req, res);
      if (!session) return;
      const conversationId = url.pathname.split("/")[3];
      const conversation = db.conversations.find((item) => item.id === conversationId);
      if (!conversation || !conversation.participantIds.includes(session.user.id)) {
        return sendJson(res, 404, { error: "Không tìm thấy cuộc trò chuyện." });
      }

      const body = await readJson(req);
      const messageId = String(body.messageId || "");
      const message = db.messages.find((item) => item.id === messageId && item.conversationId === conversation.id);
      if (!message) return sendJson(res, 404, { error: "Không tìm thấy tin nhắn để ghim." });

      conversation.pinnedMessageId = message.id;
      saveDb();
      pushConversationRefresh(conversation, "message-pinned", session.user.id);
      return sendJson(res, 200, { conversation: publicConversation(conversation, session.user.id) });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/conversations/") && url.pathname.endsWith("/pin")) {
      const session = requireAuth(req, res);
      if (!session) return;
      const conversationId = url.pathname.split("/")[3];
      const conversation = db.conversations.find((item) => item.id === conversationId);
      if (!conversation || !conversation.participantIds.includes(session.user.id)) {
        return sendJson(res, 404, { error: "Không tìm thấy cuộc trò chuyện." });
      }
      conversation.pinnedMessageId = "";
      saveDb();
      pushConversationRefresh(conversation, "message-unpinned", session.user.id);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/conversations/") && url.pathname.endsWith("/tasks")) {
      const session = requireAuth(req, res);
      if (!session) return;
      const conversationId = url.pathname.split("/")[3];
      const tasks = getTasksForConversation(session.user.id, conversationId);
      if (!tasks) return sendJson(res, 404, { error: "Không tìm thấy cuộc trò chuyện." });
      return sendJson(res, 200, { tasks });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/conversations/") && url.pathname.endsWith("/tasks")) {
      const session = requireAuth(req, res);
      if (!session) return;
      const conversationId = url.pathname.split("/")[3];
      const conversation = db.conversations.find((item) => item.id === conversationId);
      if (!conversation || !conversation.participantIds.includes(session.user.id)) {
        return sendJson(res, 404, { error: "Không tìm thấy cuộc trò chuyện." });
      }

      const body = await readJson(req);
      const title = String(body.title || "").trim().slice(0, 140);
      const description = String(body.description || "").trim().slice(0, 500);
      const assigneeId = String(body.assigneeId || "");
      if (!title) return sendJson(res, 400, { error: "Vui lòng nhập tên việc." });
      if (!conversation.participantIds.includes(assigneeId)) {
        return sendJson(res, 400, { error: "Người được giao việc phải nằm trong cuộc trò chuyện." });
      }

      const task = {
        id: createId("task"),
        conversationId,
        title,
        description,
        assigneeId,
        createdBy: session.user.id,
        status: "open",
        createdAt: new Date().toISOString()
      };
      db.tasks.push(task);
      db.messages.push({
        id: createId("msg"),
        conversationId,
        senderId: session.user.id,
        text: `Đã giao việc: ${title}`,
        type: "task",
        createdAt: new Date().toISOString()
      });
      saveDb();
      pushConversationRefresh(conversation, "task-created", session.user.id);
      return sendJson(res, 201, { task: publicTask(task) });
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/api/tasks/")) {
      const session = requireAuth(req, res);
      if (!session) return;
      const taskId = decodeURIComponent(url.pathname.split("/")[3] || "");
      const task = db.tasks.find((candidate) => candidate.id === taskId);
      const conversation = task ? db.conversations.find((item) => item.id === task.conversationId) : null;
      if (!task || !conversation || !conversation.participantIds.includes(session.user.id)) {
        return sendJson(res, 404, { error: "Không tìm thấy việc." });
      }

      const body = await readJson(req);
      if (typeof body.status === "string" && ["open", "done"].includes(body.status)) {
        task.status = body.status;
        task.completedAt = body.status === "done" ? new Date().toISOString() : "";
      }
      if (typeof body.title === "string" && body.title.trim()) task.title = body.title.trim().slice(0, 140);
      if (typeof body.description === "string") task.description = body.description.trim().slice(0, 500);
      if (typeof body.assigneeId === "string" && conversation.participantIds.includes(body.assigneeId)) {
        task.assigneeId = body.assigneeId;
      }
      saveDb();
      pushConversationRefresh(conversation, "task-updated", session.user.id);
      return sendJson(res, 200, { task: publicTask(task) });
    }

    if (req.method === "POST" && url.pathname === "/api/calls/signal") {
      const session = requireAuth(req, res);
      if (!session) return;
      const body = await readJson(req);
      const conversationId = String(body.conversationId || "");
      const type = String(body.type || "");
      const callId = String(body.callId || "");
      const targetUserId = String(body.targetUserId || "");
      const conversation = db.conversations.find((item) => item.id === conversationId);

      if (!conversation || !conversation.participantIds.includes(session.user.id)) {
        return sendJson(res, 404, { error: "Không tìm thấy cuộc trò chuyện." });
      }

      const allowedTypes = new Set(["offer", "answer", "candidate", "hangup", "reject", "busy", "join"]);
      if (!allowedTypes.has(type) || !callId) {
        return sendJson(res, 400, { error: "Tín hiệu cuộc gọi không hợp lệ." });
      }

      const recipients =
        targetUserId && conversation.participantIds.includes(targetUserId)
          ? [targetUserId]
          : conversation.participantIds.filter((userId) => userId !== session.user.id);
      pushEvent(recipients, "call-signal", {
        conversationId,
        callId,
        type,
        targetUserId,
        payload: body.payload || {},
        from: publicUser(session.user)
      });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const session = requireAuth(req, res);
      if (!session) return;

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      res.write("event: ready\n");
      res.write(`data: ${JSON.stringify({ userId: session.user.id })}\n\n`);

      if (!eventClients.has(session.user.id)) eventClients.set(session.user.id, new Set());
      eventClients.get(session.user.id).add(res);

      req.on("close", () => {
        const clients = eventClients.get(session.user.id);
        if (clients) {
          clients.delete(res);
          if (!clients.size) eventClients.delete(session.user.id);
        }
      });
      return;
    }

    sendJson(res, 404, { error: "API không tồn tại." });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Có lỗi xảy ra." });
  }
}

function acceptRequest(currentUser, request, res) {
  request.status = "accepted";
  request.acceptedAt = new Date().toISOString();

  const existing = findDirectConversation(request.fromUserId, request.toUserId);
  const conversation =
    existing ||
    {
      id: createId("conv"),
      type: "direct",
      participantIds: [request.fromUserId, request.toUserId],
      createdBy: currentUser.id,
      pinnedMessageId: "",
      createdAt: new Date().toISOString()
    };

  if (!existing) {
    db.conversations.push(conversation);
    db.messages.push({
      id: createId("msg"),
      conversationId: conversation.id,
      senderId: currentUser.id,
      text: "Chúng ta đã kết bạn. Bắt đầu trò chuyện nhé!",
      type: "system",
      createdAt: new Date().toISOString()
    });
  }

  saveDb();
  pushConversationRefresh(conversation, "friend-accepted", currentUser.id);
  return sendJson(res, 200, { conversation: publicConversation(conversation, currentUser.id) });
}

function serveStatic(req, res, url) {
  const safePath = path.normalize(url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname));
  const filePath = path.join(root, safePath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url);
});

server.listen(port, "0.0.0.0", () => {
  saveDb();
  console.log(`Gmail Chat đang chạy tại http://localhost:${port}`);
  console.log("Mở cùng URL từ trình duyệt/thiết bị khác trong mạng này để thử chat realtime.");
});
