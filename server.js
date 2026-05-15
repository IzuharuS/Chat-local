const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const CHATS_DIR = path.resolve(__dirname, 'chats');
const MANIFEST_FILE = path.join(CHATS_DIR, '_manifest.json');

// Ensure chats directory exists
if (!fs.existsSync(CHATS_DIR)) {
  fs.mkdirSync(CHATS_DIR);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Manifest: maps displayName -> uuid (used as filename)
// { "General": "a1b2c3d4...", ... }
let manifest = {};

function loadManifest() {
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  } catch {
    manifest = {};
  }
}

function saveManifest() {
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8');
}

loadManifest();

// Helper: get safe file path from a uuid (trusted internal value)
function chatFileById(uuid) {
  return path.join(CHATS_DIR, `${uuid}.txt`);
}

// Helper: sanitize display name
function sanitizeDisplayName(name) {
  return name.replace(/[<>"'`]/g, '').trim().slice(0, 50);
}

// Helper: read messages from file
async function readMessages(uuid) {
  try {
    const content = await fs.promises.readFile(chatFileById(uuid), 'utf8');
    return content.split('\n').filter(Boolean).map(line => {
      const match = line.match(/^\[([^\]]+)\] ([^:]+): (.*)$/);
      return match ? { timestamp: match[1], sender: match[2], text: match[3] } : null;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// Helper: append message to file
async function appendMessage(uuid, sender, text) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${sender}: ${text}\n`;
  await fs.promises.appendFile(chatFileById(uuid), line, 'utf8');
  return { timestamp, sender, text };
}

// GET /api/chats — list all chats
app.get('/api/chats', apiLimiter, (req, res) => {
  res.json(Object.keys(manifest));
});

// POST /api/chats — create a chat
app.post('/api/chats', apiLimiter, async (req, res) => {
  const raw = req.body && req.body.name ? req.body.name : '';
  const name = sanitizeDisplayName(raw);
  if (!name) {
    return res.status(400).json({ error: 'Chat name is required' });
  }
  if (manifest[name]) {
    return res.status(409).json({ error: 'Chat already exists' });
  }
  const uuid = crypto.randomUUID();
  await fs.promises.writeFile(chatFileById(uuid), '', 'utf8');
  manifest[name] = uuid;
  saveManifest();
  io.emit('chat:created', name);
  res.json({ name });
});

// DELETE /api/chats/:name — delete a chat
app.delete('/api/chats/:name', apiLimiter, async (req, res) => {
  const name = sanitizeDisplayName(req.params.name);
  const uuid = manifest[name];
  if (!uuid) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  try {
    await fs.promises.unlink(chatFileById(uuid));
  } catch {
    // file may already be gone
  }
  delete manifest[name];
  saveManifest();
  io.emit('chat:deleted', name);
  res.json({ ok: true });
});

// GET /api/chats/:name/messages — history
app.get('/api/chats/:name/messages', apiLimiter, async (req, res) => {
  const name = sanitizeDisplayName(req.params.name);
  const uuid = manifest[name];
  if (!uuid) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  res.json(await readMessages(uuid));
});

// Socket.io
io.on('connection', (socket) => {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const rawIp = forwarded
    ? forwarded.split(',')[0].trim()
    : (socket.handshake.address || 'unknown');
  const ip = rawIp === '::1' ? '127.0.0.1' : rawIp.replace(/^::ffff:/, '');

  let userIdentifier = ip;

  socket.on('user:identify', (name) => {
    if (typeof name === 'string' && name.trim()) {
      userIdentifier = name.trim().replace(/[<>"'`]/g, '').slice(0, 30) || ip;
    }
    socket.emit('user:identified', { identifier: userIdentifier, ip });
  });

  socket.on('chat:join', (chatName) => {
    if (typeof chatName !== 'string') return;
    const name = sanitizeDisplayName(chatName);
    if (!manifest[name]) return;
    socket.rooms.forEach(room => {
      if (room !== socket.id) socket.leave(room);
    });
    socket.join(name);
    socket.currentChat = name;
  });

  socket.on('message:send', async ({ chatName, text }) => {
    if (typeof chatName !== 'string' || typeof text !== 'string' || !text.trim()) return;
    const name = sanitizeDisplayName(chatName);
    const uuid = manifest[name];
    if (!uuid) return;
    const msg = await appendMessage(uuid, userIdentifier, text.trim());
    io.to(name).emit('message:new', { chatName: name, ...msg });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chat-local running on http://0.0.0.0:${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});

