const { app, BrowserWindow, screen, desktopCapturer, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const log = require('electron-log');
const Store = require('electron-store');
const { io } = require('socket.io-client');
const { autoUpdater } = require('electron-updater');

log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const store = new Store({
  defaults: {
    serverUrl: process.env.VIEWLOCAL_SERVER || 'http://192.168.0.9:4000',
    captureInterval: 1000,
    jpegQuality: 0.6,
    maxWidth: 1280,
    launchOnStartup: true,
  },
});

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

function applyBootstrapConfig() {
  try {
    const candidates = [];
    try { candidates.push(path.join(app.getPath('userData'), 'bootstrap.json')); } catch (_) {}
    if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'ViewLocal Client', 'bootstrap.json'));
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      let bs;
      try {
        bs = readJsonFlexible(p);
      } catch (e) {
        log.warn('bootstrap parse failed for', p, e.message);
        continue;
      }
      log.info('applying bootstrap config from', p, bs);
      if (bs.serverUrl) store.set('serverUrl', String(bs.serverUrl).trim());
      if (bs.captureInterval) store.set('captureInterval', Number(bs.captureInterval));
      if (bs.maxWidth) store.set('maxWidth', Number(bs.maxWidth));
      if (bs.jpegQuality) store.set('jpegQuality', Number(bs.jpegQuality));
      if (typeof bs.launchOnStartup === 'boolean') store.set('launchOnStartup', bs.launchOnStartup);
      try { fs.unlinkSync(p); } catch (_) {}
      return true;
    }
  } catch (e) {
    log.warn('bootstrap config apply failed', e);
  }
  return false;
}

let settingsWin = null;
let captureWin = null;
let socket = null;
let captureTimer = null;
let lastSentAt = 0;
let isCapturing = false;

const APP_VERSION = app.getVersion();
const HOSTNAME = os.hostname();
const USERNAME = os.userInfo().username;
const OS_LABEL = `${os.platform()} ${os.release()}`;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // If the competing instance was a background autostart (--hidden),
    // don't disturb: just let single-instance lock dedupe silently.
    if (Array.isArray(argv) && argv.includes('--hidden')) return;
    if (settingsWin) {
      if (settingsWin.isMinimized()) settingsWin.restore();
      settingsWin.focus();
    } else {
      openSettings();
    }
  });
}

function openSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 520, height: 440, resizable: false, minimizable: true, maximizable: false,
    title: 'ViewLocal Client — Settings',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

async function ensureCaptureWindow() {
  if (captureWin && !captureWin.isDestroyed()) return captureWin;
  captureWin = new BrowserWindow({
    width: 200, height: 200,
    show: false,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, offscreen: false },
  });
  captureWin.loadURL('about:blank');
  await new Promise((r) => captureWin.webContents.once('did-finish-load', r));
  return captureWin;
}

async function captureFrame() {
  const primary = screen.getPrimaryDisplay();
  const targetMaxW = store.get('maxWidth', 1280);
  const scale = Math.min(1, targetMaxW / primary.size.width);
  const w = Math.round(primary.size.width * scale);
  const h = Math.round(primary.size.height * scale);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: w, height: h },
    fetchWindowIcons: false,
  });
  if (!sources.length) return null;
  const src = sources.find((s) => s.display_id === String(primary.id)) || sources[0];
  const img = src.thumbnail;
  if (img.isEmpty()) return null;
  const quality = Math.round((store.get('jpegQuality', 0.6)) * 100);
  const jpg = img.toJPEG(Math.max(10, Math.min(100, quality)));
  return { buffer: jpg, width: img.getSize().width, height: img.getSize().height };
}

function connect() {
  const url = store.get('serverUrl');
  if (!url) return;
  if (socket) { try { socket.close(); } catch (_) {} socket = null; }
  log.info('Connecting to', url);
  socket = io(`${url.replace(/\/$/, '')}/client`, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    auth: {
      hostname: HOSTNAME,
      username: USERNAME,
      os: OS_LABEL,
      version: APP_VERSION,
      screenWidth: screen.getPrimaryDisplay().size.width,
      screenHeight: screen.getPrimaryDisplay().size.height,
    },
  });
  socket.on('connect', () => { log.info('socket connected', socket.id); });
  socket.on('disconnect', (reason) => { log.info('socket disconnected', reason); });
  socket.on('connect_error', (err) => { log.warn('connect_error', err.message); });
}

function startCaptureLoop() {
  if (captureTimer) clearInterval(captureTimer);
  const interval = Math.max(200, store.get('captureInterval', 1000));
  captureTimer = setInterval(async () => {
    if (isCapturing) return;
    if (!socket || !socket.connected) return;
    isCapturing = true;
    try {
      const frame = await captureFrame();
      if (!frame) return;
      const b64 = frame.buffer.toString('base64');
      socket.emit('frame', {
        image: b64,
        width: frame.width,
        height: frame.height,
        ts: Date.now(),
      });
      lastSentAt = Date.now();
    } catch (e) {
      log.error('capture failed', e);
    } finally {
      isCapturing = false;
    }
  }, interval);
}

async function checkForUpdatesManual() {
  try {
    const res = await autoUpdater.checkForUpdates();
    if (!res || !res.updateInfo) {
      dialog.showMessageBox({ type: 'info', message: 'Up to date', detail: `Current version: ${APP_VERSION}` });
    }
  } catch (e) {
    dialog.showMessageBox({ type: 'error', message: 'Update check failed', detail: String(e.message || e) });
  }
}

function wireAutoUpdater() {
  autoUpdater.on('update-available', (info) => {
    log.info('update-available', info.version);
  });
  autoUpdater.on('update-not-available', () => log.info('update-not-available'));
  autoUpdater.on('error', (err) => log.error('updater error', err));
  autoUpdater.on('download-progress', (p) => log.info(`download ${Math.round(p.percent)}%`));
  autoUpdater.on('update-downloaded', (info) => {
    log.info('update-downloaded', info.version);
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 3000);
  });
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((e) => log.warn('auto check failed', e.message));
  }, 30 * 60 * 1000);
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((e) => log.warn('initial check failed', e.message));
  }, 15 * 1000);
}

ipcMain.handle('settings:get', () => ({
  serverUrl: store.get('serverUrl'),
  captureInterval: store.get('captureInterval'),
  jpegQuality: store.get('jpegQuality'),
  maxWidth: store.get('maxWidth'),
  launchOnStartup: store.get('launchOnStartup'),
  version: APP_VERSION,
  hostname: HOSTNAME,
  username: USERNAME,
  os: OS_LABEL,
  connected: !!(socket && socket.connected),
}));

ipcMain.handle('settings:save', (_evt, payload) => {
  if (payload && typeof payload === 'object') {
    if (payload.serverUrl) store.set('serverUrl', String(payload.serverUrl).trim());
    if (payload.captureInterval) store.set('captureInterval', Number(payload.captureInterval));
    if (payload.jpegQuality) store.set('jpegQuality', Number(payload.jpegQuality));
    if (payload.maxWidth) store.set('maxWidth', Number(payload.maxWidth));
    if (typeof payload.launchOnStartup === 'boolean') {
      store.set('launchOnStartup', payload.launchOnStartup);
    }
  }
  connect();
  startCaptureLoop();
  return true;
});

ipcMain.handle('update:check', async () => {
  try { await autoUpdater.checkForUpdates(); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.poldeco.viewlocal.client');
  applyBootstrapConfig();
  await ensureCaptureWindow();
  connect();
  startCaptureLoop();
  wireAutoUpdater();
  const args = process.argv.slice(1);
  if (!args.includes('--hidden')) {
    setTimeout(() => openSettings(), 500);
  }
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  if (captureTimer) clearInterval(captureTimer);
  if (socket) try { socket.close(); } catch (_) {}
});
