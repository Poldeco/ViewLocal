'use strict';
// ViewLocal Watchdog — runs as a SYSTEM scheduled task (session 0).
//
// Purpose: keep the capture agent alive in the interactive user's session.
// A standard (non-admin) user can End-Task the agent in their own session, but
// they cannot kill THIS process (it runs as LocalSystem -> "Access denied"),
// and they cannot disable/delete the scheduled tasks (admin-protected). When
// the agent dies, its heartbeat goes stale and we relaunch it within seconds.
//
// Stopping permanently is an admin action: disable the "ViewLocal Watchdog"
// task or uninstall. This is a supervisor, not a stealth/anti-tamper hack —
// the agent stays visible in Task Manager and the admin keeps full control.
//
// Launched via Electron-as-Node (ELECTRON_RUN_AS_NODE=1), so no separate
// Node.js runtime is required on target machines. Uses only built-in modules.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DATA_DIR = path.join(process.env.ProgramData || 'C:\\ProgramData', 'ViewLocal');
const HEARTBEAT = path.join(DATA_DIR, 'agent-heartbeat');
const LOG_FILE = path.join(DATA_DIR, 'watchdog.log');
const AGENT_TASK = process.env.VIEWLOCAL_AGENT_TASK || 'ViewLocal Agent';

const POLL_MS = 1000;            // how often we check the heartbeat
const STALE_MS = 4000;           // heartbeat older than this => agent considered dead
const LAUNCH_COOLDOWN_MS = 5000; // min gap between relaunch attempts (avoid spam)

let lastLaunch = 0;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    // Keep the log from growing unbounded on long-running machines.
    let size = 0;
    try { size = fs.statSync(LOG_FILE).size; } catch (_) {}
    if (size > 512 * 1024) { try { fs.unlinkSync(LOG_FILE); } catch (_) {} }
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {}
}

function heartbeatAgeMs() {
  try {
    return Date.now() - fs.statSync(HEARTBEAT).mtimeMs;
  } catch (_) {
    return Infinity; // no heartbeat yet => treat as dead
  }
}

function relaunchAgent() {
  const now = Date.now();
  if (now - lastLaunch < LAUNCH_COOLDOWN_MS) return;
  lastLaunch = now;
  // schtasks /Run starts the agent task in whatever session its (interactive,
  // logon-only) principal resolves to. If nobody is logged on, the task simply
  // doesn't start and returns an error — harmless, the cooldown throttles us.
  execFile('schtasks', ['/Run', '/TN', AGENT_TASK], { windowsHide: true }, (err, _so, se) => {
    if (err) {
      const detail = ((se && se.toString()) || err.message || '').trim();
      log(`schtasks /Run "${AGENT_TASK}" failed: ${detail}`);
    } else {
      log(`relaunched agent (heartbeat was stale) via task "${AGENT_TASK}"`);
    }
  });
}

function tick() {
  if (heartbeatAgeMs() > STALE_MS) relaunchAgent();
}

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
log(`watchdog started (poll=${POLL_MS}ms stale=${STALE_MS}ms task="${AGENT_TASK}")`);

setInterval(tick, POLL_MS);
tick();

// Keep the event loop alive even if something clears the interval.
process.stdin.resume?.();
