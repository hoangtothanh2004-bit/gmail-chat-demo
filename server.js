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
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

const sessions = new Map();
const eventClients = new Map();

let db = loadDb();

function loadDb() {
  if (fs.existsSync(dbPath)) {
    try {
      return JSON.parse(fs.readFileSync(dbPath, "utf8"));
    } catch {
      return createDb();
    }
  }

  return createDb();
}

function createDb() {
  const demoA = createUser("Demo One", "demo1@gmail.com", "123456");
  const demoB = createUser("Demo Two", "demo2@gmail.com", "123456");
  const conversationId = createId("conv");
  const now = new Date().toISOString();

  return {
    users: [demoA, demoB],
    friendRequests: [],
    conversations: [
      {
        id: conversationId,
        type: "direct",
        participantIds: [demoA.id, demoB.id],
        createdAt: now
      }
    ],
    messages: [
      {
        id: createId("msg"),
        conversationId,
        senderId: demoA.id,
        text: "Chao ban, day la phong chat realtime demo.",
        createdAt: now
      },
      {
        id: createId("msg"),
        conversationId,
        senderId: demoB.id,
        text: "Dang nhap bang demo2@gmail.com tren trinh duyet khac de thu chat truc tuyen.",
        createdAt: new Date(Date.now() + 1000).toISOString()
      }
    ]
  };
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
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: initials(user.name || user.email)
  };
}

function initials(value) {
  return String(value)
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
      if (!raw) {
        resolve({});
        return;
      }
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
    sendJson(res, 401, { error: "Can dang nhap." });
    return null;
  }
  return session;
}

function friendStatus(currentUserId, targetUserId) {
  if (currentUserId === targetUserId) return "self";

  const conversation = findDirectConversation(currentUserId, targetUserId);
  if (conversation) return "friend";

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

function findDirectConversation(userA, userB) {
  return db.conversations.find(
    (conversation) =>
      conversation.type === "direct" &&
      conversation.participantIds.includes(userA) &&
      conversation.participantIds.includes(userB)
  );
}

function getConversationsFor(userId) {
  return db.conversations
    .filter((conversation) => conversation.participantIds.includes(userId))
    .map((conversation) => {
      const otherId = conversation.participantIds.find((id) => id !== userId);
      const other = db.users.find((user) => user.id === otherId) || db.users.find((user) => user.id === userId);
      const messages = db.messages
        .filter((message) => message.conversationId === conversation.id)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const lastMessage = messages[messages.length - 1] || null;

      return {
        id: conversation.id,
        type: conversation.type,
        peer: publicUser(other),
        lastMessage,
        updatedAt: lastMessage?.createdAt || conversation.createdAt,
        messageCount: messages.length
      };
    })
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
      sender: publicUser(db.users.find((user) => user.id === message.senderId))
    }));
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
  const uniqueIds = [...new Set(userIds)];
  uniqueIds.forEach((userId) => {
    const clients = eventClients.get(userId) || new Set();
    clients.forEach((res) => {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    });
  });
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "POST" && url.pathname === "/api/register") {
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");

      if (!name) return sendJson(res, 400, { error: "Vui long nhap ten hien thi." });
      if (!isGmail(email)) return sendJson(res, 400, { error: "Chi chap nhan dia chi @gmail.com." });
      if (password.length < 6) return sendJson(res, 400, { error: "Mat khau can toi thieu 6 ky tu." });
      if (findUserByEmail(email)) return sendJson(res, 409, { error: "Gmail nay da duoc dang ky." });

      const user = createUser(name, email, password);
      db.users.push(user);
      saveDb();
      const token = createId("session");
      sessions.set(token, user.id);
      return sendJson(res, 201, { token, user: publicUser(user) });
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readJson(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = findUserByEmail(email);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return sendJson(res, 401, { error: "Sai Gmail hoac mat khau." });
      }

      const token = createId("session");
      sessions.set(token, user.id);
      return sendJson(res, 200, { token, user: publicUser(user) });
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      const session = requireAuth(req, res);
      if (!session) return;
      return sendJson(res, 200, {
        user: publicUser(session.user),
        conversations: getConversationsFor(session.user.id),
        requests: getRequestsFor(session.user.id)
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

      if (!target) return sendJson(res, 404, { error: "Khong tim thay tai khoan Gmail nay." });
      if (target.id === session.user.id) return sendJson(res, 400, { error: "Khong the ket ban voi chinh minh." });
      if (findDirectConversation(session.user.id, target.id)) return sendJson(res, 409, { error: "Hai tai khoan da la ban be." });

      const incoming = db.friendRequests.find(
        (request) => request.fromUserId === target.id && request.toUserId === session.user.id && request.status === "pending"
      );
      if (incoming) {
        return acceptRequest(session.user, incoming, res);
      }

      const existing = db.friendRequests.find(
        (request) => request.fromUserId === session.user.id && request.toUserId === target.id && request.status === "pending"
      );
      if (existing) return sendJson(res, 409, { error: "Loi moi ket ban da duoc gui truoc do." });

      const request = {
        id: createId("req"),
        fromUserId: session.user.id,
        toUserId: target.id,
        status: "pending",
        createdAt: new Date().toISOString()
      };
      db.friendRequests.push(request);
      saveDb();
      pushEvent([target.id], "refresh", { reason: "friend-request" });
      return sendJson(res, 201, { request });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/friend-requests/") && url.pathname.endsWith("/accept")) {
      const session = requireAuth(req, res);
      if (!session) return;
      const requestId = url.pathname.split("/")[3];
      const request = db.friendRequests.find(
        (candidate) => candidate.id === requestId && candidate.toUserId === session.user.id && candidate.status === "pending"
      );
      if (!request) return sendJson(res, 404, { error: "Khong tim thay loi moi ket ban." });
      return acceptRequest(session.user, request, res);
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/conversations/") && url.pathname.endsWith("/messages")) {
      const session = requireAuth(req, res);
      if (!session) return;
      const conversationId = url.pathname.split("/")[3];
      const messages = getMessagesFor(session.user.id, conversationId);
      if (!messages) return sendJson(res, 404, { error: "Khong tim thay cuoc tro chuyen." });
      return sendJson(res, 200, { messages });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/conversations/") && url.pathname.endsWith("/messages")) {
      const session = requireAuth(req, res);
      if (!session) return;
      const conversationId = url.pathname.split("/")[3];
      const conversation = db.conversations.find((item) => item.id === conversationId);
      if (!conversation || !conversation.participantIds.includes(session.user.id)) {
        return sendJson(res, 404, { error: "Khong tim thay cuoc tro chuyen." });
      }

      const body = await readJson(req);
      const text = String(body.text || "").trim();
      if (!text) return sendJson(res, 400, { error: "Tin nhan dang rong." });
      if (text.length > 2000) return sendJson(res, 400, { error: "Tin nhan qua dai." });

      const message = {
        id: createId("msg"),
        conversationId,
        senderId: session.user.id,
        text,
        createdAt: new Date().toISOString()
      };
      db.messages.push(message);
      saveDb();
      pushEvent(conversation.participantIds, "refresh", { reason: "message", conversationId });
      return sendJson(res, 201, { message: { ...message, sender: publicUser(session.user) } });
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

      if (!eventClients.has(session.user.id)) {
        eventClients.set(session.user.id, new Set());
      }
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

    sendJson(res, 404, { error: "API khong ton tai." });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Co loi xay ra." });
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
      createdAt: new Date().toISOString()
    };

  if (!existing) {
    db.conversations.push(conversation);
    db.messages.push({
      id: createId("msg"),
      conversationId: conversation.id,
      senderId: currentUser.id,
      text: "Chung ta da ket ban. Bat dau tro chuyen nhe!",
      createdAt: new Date().toISOString()
    });
  }

  saveDb();
  pushEvent(conversation.participantIds, "refresh", { reason: "friend-accepted", conversationId: conversation.id });
  return sendJson(res, 200, { conversation });
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
  console.log(`Gmail Chat running at http://localhost:${port}`);
  console.log("Open the same URL from another browser/device on this network to test realtime chat.");
});
