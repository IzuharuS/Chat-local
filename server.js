const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const CHATS_DIR = path.resolve(__dirname, 'chats');

// Ensure chats directory exists
if (!fs.existsSync(CHATS_DIR)) {
  fs.mkdirSync(CHATS_DIR);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Simple in-memory rate limiter: max requests per window per IP
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;
const rateLimitStore = new Map();

function rateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const record = rateLimitStore.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  record.count += 1;
  rateLimitStore.set(ip, record);

  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  next();
}

// Helper: sanitize chat name (only alphanumeric, dash, underscore)
function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 50);
}

// Helper: chat file path — always resolved inside CHATS_DIR
function chatFile(safeName) {
  const resolved = path.resolve(CHATS_DIR, `${safeName}.txt`);
  if (!resolved.startsWith(CHATS_DIR + path.sep) && resolved !== CHATS_DIR) {
    throw new Error('Invalid chat name');
  }
  return resolved;
}

// Helper: parse messages from txt file
async function readMessages(safeName) {
  const file = chatFile(safeName);
  try {
    const content = await fs.promises.readFile(file, 'utf8');
    return content.split('\n').filter(Boolean).map(line => {
      const match = line.match(/^\[([^\]]+)\] ([^:]+): (.*)$/);
      if (match) {
        return { timestamp: match[1], sender: match[2], text: match[3] };
      }
      return null;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// Helper: append message to txt file
async function appendMessage(safeName, sender, text) {
  const file = chatFile(safeName);
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${sender}: ${text}\n`;
  await fs.promises.appendFile(file, line, 'utf8');
  return { timestamp, sender, text };
}

// GET /api/chats — list all chats
app.get('/api/chats', rateLimit, async (req, res) => {
  const files = (await fs.promises.readdir(CHATS_DIR)).filter(f => f.endsWith('.txt'));
  const chats = files.map(f => path.basename(f, '.txt'));
  res.json(chats);
});

// POST /api/chats — create a chat
app.post('/api/chats', rateLimit, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Chat name is required' });
  }
  const safe = sanitizeName(name.trim());
  let file;
  try {
    file = chatFile(safe);
  } catch {
    return res.status(400).json({ error: 'Invalid chat name' });
  }
  try {
    await fs.promises.access(file);
    return res.status(409).json({ error: 'Chat already exists' });
  } catch {
    // file does not exist — create it
  }
  await fs.promises.writeFile(file, '', 'utf8');
  io.emit('chat:created', safe);
  res.json({ name: safe });
});

// DELETE /api/chats/:name — delete a chat
app.delete('/api/chats/:name', rateLimit, async (req, res) => {
  const safe = sanitizeName(req.params.name);
  let file;
  try {
    file = chatFile(safe);
  } catch {
    return res.status(400).json({ error: 'Invalid chat name' });
  }
  try {
    await fs.promises.unlink(file);
  } catch {
    return res.status(404).json({ error: 'Chat not found' });
  }
  io.emit('chat:deleted', safe);
  res.json({ ok: true });
});

// GET /api/chats/:name/messages — history
app.get('/api/chats/:name/messages', rateLimit, async (req, res) => {
  const safe = sanitizeName(req.params.name);
  let file;
  try {
    file = chatFile(safe);
  } catch {
    return res.status(400).json({ error: 'Invalid chat name' });
  }
  try {
    await fs.promises.access(file);
  } catch {
    return res.status(404).json({ error: 'Chat not found' });
  }
  res.json(await readMessages(safe));
});

// Socket.io
io.on('connection', (socket) => {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const rawIp = forwarded
    ? forwarded.split(',')[0].trim()
    : (socket.handshake.address || 'unknown');

  // Normalize IPv6 loopback to localhost
  const ip = rawIp === '::1' ? '127.0.0.1' : rawIp.replace(/^::ffff:/, '');

  let userIdentifier = ip;

  // Client sends their preferred display name
  socket.on('user:identify', (name) => {
    if (name && name.trim()) {
      userIdentifier = name.trim().slice(0, 30);
    }
    socket.emit('user:identified', { identifier: userIdentifier, ip });
  });

  // Join a chat room
  socket.on('chat:join', (chatName) => {
    const safe = sanitizeName(chatName);
    socket.rooms.forEach(room => {
      if (room !== socket.id) socket.leave(room);
    });
    socket.join(safe);
    socket.currentChat = safe;
  });

  // Send a message
  socket.on('message:send', async ({ chatName, text }) => {
    if (!chatName || !text || !text.trim()) return;
    const safe = sanitizeName(chatName);
    let file;
    try {
      file = chatFile(safe);
    } catch {
      return;
    }
    try {
      await fs.promises.access(file);
    } catch {
      return;
    }
    const msg = await appendMessage(safe, userIdentifier, text.trim());
    io.to(safe).emit('message:new', { chatName: safe, ...msg });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chat-local running on http://0.0.0.0:${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
