const { app, Tray, Menu, nativeImage, shell, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const log = require('electron-log');
const Store = require('electron-store');

log.transports.file.level = 'info';

const APP_VERSION = app.getVersion();

const store = new Store({
  defaults: {
    port: 4000,
    host: '0.0.0.0',
    openDashboardOnStart: true,
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

function applyBootstrap() {
  try {
    const candidates = [
      path.join(app.getPath('userData'), 'bootstrap.json'),
      process.env.APPDATA ? path.join(process.env.APPDATA, 'ViewLocal Server', 'bootstrap.json') : null,
    ].filter(Boolean);
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      let bs;
      try {
        bs = readJsonFlexible(p);
      } catch (e) {
        log.warn('bootstrap parse failed for', p, e.message);
        continue;
      }
      log.info('applying bootstrap', bs);
      if (bs.port) store.set('port', Number(bs.port));
      if (bs.host) store.set('host', String(bs.host));
      if (typeof bs.openDashboardOnStart === 'boolean') store.set('openDashboardOnStart', bs.openDashboardOnStart);
      if (typeof bs.launchOnStartup === 'boolean') store.set('launchOnStartup', bs.launchOnStartup);
      try { fs.unlinkSync(p); } catch (_) {}
      return true;
    }
  } catch (e) { log.warn('bootstrap apply failed', e); }
  return false;
}

function setAutoLaunch(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      path: process.execPath,
      args: ['--hidden'],
    });
  } catch (e) { log.warn('login item failed', e); }
}

let tray = null;
let serverUrl = '';
let infoWin = null;

function getLocalIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push({ iface: name, ip: net.address });
    }
  }
  return ips;
}

function iconImage() {
  const p = path.join(__dirname, '..', 'build', 'icon.png');
  if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  return nativeImage.createEmpty();
}

function buildMenu() {
  const ips = getLocalIps();
  const port = store.get('port');
  const ipItems = ips.map((x) => ({
    label: `${x.ip}:${port}  (${x.iface})`,
    click: () => shell.openExternal(`http://${x.ip}:${port}/`),
  }));
  if (ipItems.length === 0) ipItems.push({ label: 'No external IPv4 address', enabled: false });

  return Menu.buildFromTemplate([
    { label: `ViewLocal Server v${APP_VERSION}`, enabled: false },
    { label: `Listening on ${store.get('host')}:${port}`, enabled: false },
    { type: 'separator' },
    { label: 'Open dashboard', click: () => shell.openExternal(serverUrl || `http://localhost:${port}/`) },
    { label: 'Copy client URL', submenu: ipItems },
    { label: 'Show server info…', click: () => showInfo() },
    { label: 'Open logs folder', click: () => shell.showItemInFolder(log.transports.file.getFile().path) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip(`ViewLocal Server — ${store.get('host')}:${store.get('port')}`);
  tray.setContextMenu(buildMenu());
}

function showInfo() {
  if (infoWin) { infoWin.show(); return; }
  infoWin = new BrowserWindow({
    width: 520, height: 420, resizable: false, minimizable: true, maximizable: false,
    title: 'ViewLocal Server',
  });
  infoWin.setMenuBarVisibility(false);
  const port = store.get('port');
  const ips = getLocalIps();
  const ipRows = ips.map((x) => `<tr><td>${x.iface}</td><td><a href="http://${x.ip}:${port}/">http://${x.ip}:${port}/</a></td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="UTF-8"><title>ViewLocal Server</title>
    <style>body{background:#1e1e1e;color:#e6edf3;font:14px -apple-system,Segoe UI,sans-serif;padding:18px}
    h2{margin:0 0 10px;font-size:16px}table{width:100%;border-collapse:collapse;margin-top:10px}
    td{padding:6px 8px;border-bottom:1px solid #30363d}a{color:#58a6ff;text-decoration:none}
    .meta{color:#8b949e;margin-bottom:8px}</style></head><body>
    <h2>ViewLocal Server v${APP_VERSION}</h2>
    <div class="meta">Listening on <b>${store.get('host')}:${port}</b></div>
    <h3 style="font-size:13px;color:#8b949e">Share with clients:</h3>
    <table>${ipRows || '<tr><td colspan=2>No IPv4 found</td></tr>'}</table>
    <p class="meta" style="margin-top:16px">Install the client on each LAN machine and use one of the above URLs as Server URL.</p>
    </body></html>`;
  infoWin.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html));
  infoWin.on('closed', () => { infoWin = null; });
}

function startExpressServer() {
  process.env.PORT = String(store.get('port'));
  process.env.HOST = String(store.get('host'));
  process.env.VIEWLOCAL_UPDATES_DIR = path.join(app.getPath('userData'), 'updates');
  try {
    require('./index.js');
    serverUrl = `http://localhost:${store.get('port')}/`;
  } catch (e) {
    log.error('server failed to start', e);
    dialog.showErrorBox('Server failed to start', String(e.stack || e.message || e));
    app.quit();
  }
}

process.on('uncaughtException', (err) => {
  log.error('uncaughtException', err);
  const msg = err && err.code === 'EADDRINUSE'
    ? `Port ${store.get('port')} on ${store.get('host')} is already in use.\n\nEdit %APPDATA%\\ViewLocal Server\\config.json to change the port, or stop the process holding it.`
    : String(err && (err.stack || err.message) || err);
  try { dialog.showErrorBox('ViewLocal Server error', msg); } catch (_) {}
  app.isQuiting = true;
  app.exit(1);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.exit(0);
} else {
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.poldeco.viewlocal.server');
    applyBootstrap();
    setAutoLaunch(store.get('launchOnStartup'));
    startExpressServer();

    tray = new Tray(iconImage());
    refreshTray();

    const args = process.argv.slice(1);
    if (!args.includes('--hidden') && store.get('openDashboardOnStart')) {
      const host = store.get('host');
      const openHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
      setTimeout(() => shell.openExternal(`http://${openHost}:${store.get('port')}/`), 800);
    }
  });

  app.on('second-instance', () => {
    if (tray) {
      try { tray.displayBalloon({ title: 'ViewLocal Server', content: 'Already running — see tray icon.' }); } catch (_) {}
    }
  });

  app.on('window-all-closed', (e) => { e.preventDefault(); });
}
