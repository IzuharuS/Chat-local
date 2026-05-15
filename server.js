const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const CHATS_DIR = path.join(__dirname, 'chats');

// Ensure chats directory exists
if (!fs.existsSync(CHATS_DIR)) {
  fs.mkdirSync(CHATS_DIR);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Helper: sanitize chat name (only alphanumeric, dash, underscore)
function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 50);
}

// Helper: chat file path
function chatFile(chatName) {
  return path.join(CHATS_DIR, `${sanitizeName(chatName)}.txt`);
}

// Helper: parse messages from txt file
function readMessages(chatName) {
  const file = chatFile(chatName);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  return lines.map(line => {
    const match = line.match(/^\[([^\]]+)\] ([^:]+): (.*)$/);
    if (match) {
      return { timestamp: match[1], sender: match[2], text: match[3] };
    }
    return null;
  }).filter(Boolean);
}

// Helper: append message to txt file
function appendMessage(chatName, sender, text) {
  const file = chatFile(chatName);
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${sender}: ${text}\n`;
  fs.appendFileSync(file, line, 'utf8');
  return { timestamp, sender, text };
}

// GET /api/chats — list all chats
app.get('/api/chats', (req, res) => {
  const files = fs.readdirSync(CHATS_DIR).filter(f => f.endsWith('.txt'));
  const chats = files.map(f => path.basename(f, '.txt'));
  res.json(chats);
});

// POST /api/chats — create a chat
app.post('/api/chats', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Chat name is required' });
  }
  const safe = sanitizeName(name.trim());
  const file = chatFile(safe);
  if (fs.existsSync(file)) {
    return res.status(409).json({ error: 'Chat already exists' });
  }
  fs.writeFileSync(file, '', 'utf8');
  io.emit('chat:created', safe);
  res.json({ name: safe });
});

// DELETE /api/chats/:name — delete a chat
app.delete('/api/chats/:name', (req, res) => {
  const safe = sanitizeName(req.params.name);
  const file = chatFile(safe);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  fs.unlinkSync(file);
  io.emit('chat:deleted', safe);
  res.json({ ok: true });
});

// GET /api/chats/:name/messages — history
app.get('/api/chats/:name/messages', (req, res) => {
  const safe = sanitizeName(req.params.name);
  const file = chatFile(safe);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  res.json(readMessages(safe));
});

// Socket.io
io.on('connection', (socket) => {
  const clientIp =
    socket.handshake.headers['x-forwarded-for'] ||
    socket.handshake.address ||
    'unknown';

  // Normalize IPv6 loopback to localhost
  const ip = clientIp === '::1' ? '127.0.0.1' : clientIp.replace(/^::ffff:/, '');

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
  socket.on('message:send', ({ chatName, text }) => {
    if (!chatName || !text || !text.trim()) return;
    const safe = sanitizeName(chatName);
    const file = chatFile(safe);
    if (!fs.existsSync(file)) return;

    const msg = appendMessage(safe, userIdentifier, text.trim());
    io.to(safe).emit('message:new', { chatName: safe, ...msg });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chat-local running on http://0.0.0.0:${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
