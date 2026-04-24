const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

function readJsonFlexible(p) {
  const buf = fs.readFileSync(p);
  let text;
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    text = buf.slice(2).toString('utf16le');
  } else if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    text = buf.slice(3).toString('utf8');
  } else if (buf.length >= 2 && buf.length % 2 === 0 && buf[1] === 0x00) {
    text = buf.toString('utf16le');
  } else {
    text = buf.toString('utf8');
  }
  return JSON.parse(text);
}

function readBootstrap() {
  const candidates = [];
  if (process.env.VIEWLOCAL_CONFIG) candidates.push(process.env.VIEWLOCAL_CONFIG);
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'ViewLocal Server', 'bootstrap.json'));
  candidates.push(path.join(__dirname, '..', 'bootstrap.json'));
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return readJsonFlexible(p);
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
const activeRecordings = new Map();

const recordingsDir = process.env.VIEWLOCAL_RECORDINGS_DIR
  || path.join(__dirname, '..', 'recordings');
try { fs.mkdirSync(recordingsDir, { recursive: true }); } catch (_) {}

function resolveFfmpegPath() {
  try {
    let p = require('ffmpeg-static');
    if (p && p.includes('app.asar' + path.sep)) {
      p = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    }
    return p;
  } catch (_) { return null; }
}

function sanitizeName(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'client';
}

function broadcastActiveRecordings() {
  const list = Array.from(activeRecordings.values()).map((s) => ({
    clientId: s.clientId,
    sessionId: s.sessionId,
    hostname: s.hostname,
    startedAt: s.startedAt,
    frameCount: s.frameCount,
  }));
  io.to('viewers').emit('recordings-active', list);
}

function startRecording(clientId) {
  if (activeRecordings.has(clientId)) return activeRecordings.get(clientId);
  const c = clients.get(clientId);
  if (!c) throw new Error('client not connected');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const sessionId = `${stamp}_${sanitizeName(c.hostname)}`;
  const dir = path.join(recordingsDir, `.tmp_${sessionId}`);
  fs.mkdirSync(dir, { recursive: true });
  const session = {
    sessionId,
    clientId,
    hostname: c.hostname,
    dir,
    startedAt: Date.now(),
    frameCount: 0,
    lastFrameAt: 0,
  };
  activeRecordings.set(clientId, session);
  console.log(`[rec] start ${sessionId}`);
  broadcastActiveRecordings();
  return session;
}

function encodeMp4(frameDir, fps, outPath) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
      return reject(new Error('ffmpeg not found'));
    }
    const args = [
      '-y',
      '-framerate', String(Math.max(1, Math.min(60, fps))),
      '-i', path.join(frameDir, 'frame-%06d.jpg'),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
      outPath,
    ];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`));
    });
  });
}

async function stopRecording(clientId) {
  const session = activeRecordings.get(clientId);
  if (!session) throw new Error('not recording');
  activeRecordings.delete(clientId);
  broadcastActiveRecordings();
  console.log(`[rec] stop ${session.sessionId} frames=${session.frameCount}`);
  if (session.frameCount === 0) {
    try { fs.rmSync(session.dir, { recursive: true, force: true }); } catch (_) {}
    return { ok: true, frames: 0 };
  }
  const durationSec = Math.max(0.001, (Date.now() - session.startedAt) / 1000);
  const fps = Math.max(1, Math.round(session.frameCount / durationSec));
  const outName = `${session.sessionId}.mp4`;
  const outPath = path.join(recordingsDir, outName);
  try {
    await encodeMp4(session.dir, fps, outPath);
    try { fs.rmSync(session.dir, { recursive: true, force: true }); } catch (_) {}
    return { ok: true, frames: session.frameCount, fps, file: outName, url: `/recordings/${encodeURIComponent(outName)}` };
  } catch (e) {
    console.error('[rec] encode failed', e.message);
    return { ok: false, frames: session.frameCount, error: e.message };
  }
}

function listRecordings() {
  try {
    return fs.readdirSync(recordingsDir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.mp4'))
      .map((d) => {
        const p = path.join(recordingsDir, d.name);
        const st = fs.statSync(p);
        return {
          name: d.name,
          size: st.size,
          mtime: st.mtimeMs,
          url: `/recordings/${encodeURIComponent(d.name)}`,
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (_) { return []; }
}

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

    const session = activeRecordings.get(socket.id);
    if (session && payload && payload.image) {
      session.frameCount += 1;
      session.lastFrameAt = c.lastFrameAt;
      const idx = String(session.frameCount).padStart(6, '0');
      const file = path.join(session.dir, `frame-${idx}.jpg`);
      try {
        const b64 = payload.image.startsWith('data:') ? payload.image.split(',').pop() : payload.image;
        fs.writeFile(file, Buffer.from(b64, 'base64'), (err) => {
          if (err) console.error('[rec] write failed', err.message);
        });
      } catch (e) {
        console.error('[rec] frame decode failed', e.message);
      }
    }
  });

  socket.on('disconnect', () => {
    if (activeRecordings.has(socket.id)) {
      stopRecording(socket.id).catch((e) => console.error('[rec] auto-stop failed', e.message));
    }
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
  socket.emit('recordings-active', Array.from(activeRecordings.values()).map((s) => ({
    clientId: s.clientId, sessionId: s.sessionId, hostname: s.hostname,
    startedAt: s.startedAt, frameCount: s.frameCount,
  })));

  socket.on('request-frame', (clientId) => {
    const f = latestFrames.get(clientId);
    if (f) socket.emit('frame', f);
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, clients: clients.size, ts: Date.now(), ffmpeg: !!resolveFfmpegPath() });
});

app.get('/api/clients', (_req, res) => {
  res.json(buildClientList());
});

app.post('/api/recordings/:clientId/start', (req, res) => {
  try {
    const s = startRecording(req.params.clientId);
    res.json({ ok: true, sessionId: s.sessionId });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/recordings/:clientId/stop', async (req, res) => {
  try {
    const r = await stopRecording(req.params.clientId);
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/recordings/active', (_req, res) => {
  res.json(Array.from(activeRecordings.values()).map((s) => ({
    clientId: s.clientId, sessionId: s.sessionId, hostname: s.hostname,
    startedAt: s.startedAt, frameCount: s.frameCount,
  })));
});

app.get('/api/recordings', (_req, res) => {
  res.json(listRecordings());
});

app.get('/api/recordings/info', (_req, res) => {
  const files = listRecordings();
  res.json({
    dir: recordingsDir,
    count: files.length,
    totalBytes: files.reduce((s, f) => s + f.size, 0),
    ffmpeg: !!resolveFfmpegPath(),
  });
});

app.delete('/api/recordings/:name', (req, res) => {
  const name = req.params.name;
  if (!/^[A-Za-z0-9_\-.]+\.mp4$/.test(name)) return res.status(400).json({ ok: false, error: 'bad name' });
  const p = path.join(recordingsDir, name);
  if (!p.startsWith(recordingsDir)) return res.status(400).json({ ok: false, error: 'bad path' });
  try { fs.unlinkSync(p); res.json({ ok: true }); }
  catch (e) { res.status(404).json({ ok: false, error: e.message }); }
});

app.use('/recordings', express.static(recordingsDir, { fallthrough: true, index: false }));

const updatesDir = process.env.VIEWLOCAL_UPDATES_DIR
  || path.join(__dirname, '..', 'updates');
if (!fs.existsSync(updatesDir)) fs.mkdirSync(updatesDir, { recursive: true });
app.use('/updates', express.static(updatesDir, { fallthrough: true }));

const uiDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(uiDist)) {
  app.use(express.static(uiDist));
  app.get(/^(?!\/api|\/updates|\/recordings|\/socket\.io|\/client).*/, (_req, res) => {
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
  console.log(`  Web UI:         http://<this-host>:${PORT}/`);
  console.log(`  Clients NS:     ws://<this-host>:${PORT}/client`);
  console.log(`  Updates dir:    ${updatesDir}`);
  console.log(`  Recordings dir: ${recordingsDir}`);
  const ff = resolveFfmpegPath();
  console.log(`  ffmpeg:         ${ff && fs.existsSync(ff) ? ff : '(not found — MP4 encoding disabled)'}`);
});
