const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

function readBootstrap() {
  const candidates = [];
  if (process.env.VIEWLOCAL_CONFIG) candidates.push(process.env.VIEWLOCAL_CONFIG);
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'ViewLocal Server', 'bootstrap.json'));
  candidates.push(path.join(__dirname, '..', 'bootstrap.json'));
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        return JSON.parse(raw);
      }
    } catch (_) {}
  }
  return {};
}
const bootstrap = readBootstrap();

const PORT = Number(process.env.PORT || bootstrap.port || 4000);
const HOST = process.env.HOST || bootstrap.host || '0.0.0.0';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 20 * 1024 * 1024,
  pingInterval: 20000,
  pingTimeout: 25000,
});

const clients = new Map();
const latestFrames = new Map();

function buildClientList() {
  return Array.from(clients.values()).map((c) => ({
    id: c.id,
    hostname: c.hostname,
    username: c.username,
    os: c.os,
    version: c.version,
    connectedAt: c.connectedAt,
    lastFrameAt: c.lastFrameAt,
    screenWidth: c.screenWidth,
    screenHeight: c.screenHeight,
  }));
}

function broadcastClientList() {
  io.to('viewers').emit('clients', buildClientList());
}

const clientNs = io.of('/client');
clientNs.on('connection', (socket) => {
  const meta = socket.handshake.auth || {};
  const info = {
    id: socket.id,
    hostname: meta.hostname || 'unknown',
    username: meta.username || '',
    os: meta.os || '',
    version: meta.version || '',
    screenWidth: meta.screenWidth || 0,
    screenHeight: meta.screenHeight || 0,
    connectedAt: Date.now(),
    lastFrameAt: 0,
  };
  clients.set(socket.id, info);
  console.log(`[client] connected ${info.hostname} (${socket.id})`);
  broadcastClientList();

  socket.on('frame', (payload) => {
    const c = clients.get(socket.id);
    if (!c) return;
    c.lastFrameAt = Date.now();
    if (payload && payload.width) c.screenWidth = payload.width;
    if (payload && payload.height) c.screenHeight = payload.height;
    const frame = {
      id: socket.id,
      hostname: c.hostname,
      width: payload.width,
      height: payload.height,
      image: payload.image,
      ts: c.lastFrameAt,
    };
    latestFrames.set(socket.id, frame);
    io.to('viewers').emit('frame', frame);
  });

  socket.on('disconnect', () => {
    clients.delete(socket.id);
    latestFrames.delete(socket.id);
    console.log(`[client] disconnected ${info.hostname} (${socket.id})`);
    io.to('viewers').emit('client-gone', socket.id);
    broadcastClientList();
  });
});

io.on('connection', (socket) => {
  socket.join('viewers');
  socket.emit('clients', buildClientList());
  for (const frame of latestFrames.values()) {
    socket.emit('frame', frame);
  }

  socket.on('request-frame', (clientId) => {
    const f = latestFrames.get(clientId);
    if (f) socket.emit('frame', f);
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, clients: clients.size, ts: Date.now() });
});

app.get('/api/clients', (_req, res) => {
  res.json(buildClientList());
});

const updatesDir = process.env.VIEWLOCAL_UPDATES_DIR
  || path.join(__dirname, '..', 'updates');
if (!fs.existsSync(updatesDir)) fs.mkdirSync(updatesDir, { recursive: true });
app.use('/updates', express.static(updatesDir, { fallthrough: true }));

const uiDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(uiDist)) {
  app.use(express.static(uiDist));
  app.get(/^(?!\/api|\/updates|\/socket\.io|\/client).*/, (_req, res) => {
    res.sendFile(path.join(uiDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send('ViewLocal server running. Build frontend: cd frontend && npm run build');
  });
}

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    const hint = `Port ${PORT} on ${HOST} is already in use. Stop the other process or change port in %APPDATA%\\ViewLocal Server\\config.json.`;
    const e = new Error(hint);
    e.code = 'EADDRINUSE';
    throw e;
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`ViewLocal server listening on http://${HOST}:${PORT}`);
  console.log(`  Web UI:      http://<this-host>:${PORT}/`);
  console.log(`  Clients NS:  ws://<this-host>:${PORT}/client`);
  console.log(`  Updates dir: ${updatesDir}`);
});
