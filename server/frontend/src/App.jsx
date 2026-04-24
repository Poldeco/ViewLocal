import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const socketUrl = window.location.origin;

function useSocket() {
  const [clients, setClients] = useState([]);
  const [frames, setFrames] = useState({});
  const [connected, setConnected] = useState(false);
  const [activeRecordings, setActiveRecordings] = useState({});

  useEffect(() => {
    const socket = io(socketUrl, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('clients', (list) => setClients(list));
    socket.on('frame', (f) => {
      setFrames((prev) => ({ ...prev, [f.id]: f }));
    });
    socket.on('client-gone', (id) => {
      setFrames((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setActiveRecordings((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
    socket.on('recordings-active', (list) => {
      const map = {};
      for (const s of list) map[s.clientId] = s;
      setActiveRecordings(map);
    });
    return () => socket.close();
  }, []);

  return { clients, frames, connected, activeRecordings };
}

function formatAgo(ts) {
  if (!ts) return '—';
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 2) return 'now';
  if (sec < 60) return `${sec}s ago`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

function formatDuration(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDateTime(ms) {
  const d = new Date(ms);
  return d.toLocaleString();
}

function FrameImg({ frame, className }) {
  if (!frame || !frame.image) {
    return <div className={`frame-empty ${className || ''}`}>No signal</div>;
  }
  const src = frame.image.startsWith('data:') ? frame.image : `data:image/jpeg;base64,${frame.image}`;
  return <img className={className} src={src} alt="screen" />;
}

async function postJson(url) {
  const r = await fetch(url, { method: 'POST' });
  return r.json().catch(() => ({ ok: false, error: 'bad response' }));
}

export default function App() {
  const { clients, frames, connected, activeRecordings } = useSocket();
  const [view, setView] = useState('tiles');
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [tick, setTick] = useState(0);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const [recordingsList, setRecordingsList] = useState([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [recordingsInfo, setRecordingsInfo] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      [c.hostname, c.username, c.os, c.id].some((v) => (v || '').toLowerCase().includes(q))
    );
  }, [clients, filter]);

  const selected = selectedId ? clients.find((c) => c.id === selectedId) : null;
  const selectedFrame = selectedId ? frames[selectedId] : null;
  const selectedRec = selectedId ? activeRecordings[selectedId] : null;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (recordingsOpen) setRecordingsOpen(false);
        else setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recordingsOpen]);

  function showToast(msg, kind = 'info', ms = 3500) {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), ms);
  }

  async function toggleRecord(clientId) {
    const isRec = !!activeRecordings[clientId];
    const url = `/api/recordings/${encodeURIComponent(clientId)}/${isRec ? 'stop' : 'start'}`;
    const r = await postJson(url);
    if (!r.ok) { showToast(r.error || 'Failed', 'bad'); return; }
    if (isRec) {
      if (r.file) {
        showToast(`Saved ${r.file} (${r.frames} frames @ ${r.fps} fps)`, 'ok', 5000);
        if (recordingsOpen) loadRecordings();
      } else {
        showToast(r.frames ? `Encode failed: ${r.error}` : 'Stopped (no frames)', r.error ? 'bad' : 'info');
      }
    } else {
      showToast('Recording started', 'ok', 2000);
    }
  }

  async function loadRecordings() {
    setRecordingsLoading(true);
    try {
      const [listRes, infoRes] = await Promise.all([
        fetch('/api/recordings').then((r) => r.json()),
        fetch('/api/recordings/info').then((r) => r.json()).catch(() => null),
      ]);
      setRecordingsList(Array.isArray(listRes) ? listRes : []);
      if (infoRes) setRecordingsInfo(infoRes);
    } catch (_) { setRecordingsList([]); }
    finally { setRecordingsLoading(false); }
  }

  useEffect(() => { if (recordingsOpen) loadRecordings(); }, [recordingsOpen]);

  async function deleteRecording(name) {
    if (!confirm(`Delete ${name}?`)) return;
    const r = await fetch(`/api/recordings/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({ ok: false }));
    if (j.ok) loadRecordings();
    else showToast(j.error || 'Delete failed', 'bad');
  }

  const activeRecCount = Object.keys(activeRecordings).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◉</span> ViewLocal
          <span className={`pill ${connected ? 'ok' : 'bad'}`}>{connected ? 'connected' : 'offline'}</span>
          <span className="count">{clients.length} {clients.length === 1 ? 'client' : 'clients'}</span>
          {activeRecCount > 0 && <span className="pill rec-pill">⏺ {activeRecCount} recording</span>}
        </div>
        <div className="controls">
          <input
            className="search"
            placeholder="filter by host, user, os…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="tabs">
            <button className={view === 'tiles' ? 'tab active' : 'tab'} onClick={() => setView('tiles')}>Tiles</button>
            <button className={view === 'list' ? 'tab active' : 'tab'} onClick={() => setView('list')}>List</button>
          </div>
          <button className="btn" onClick={() => setRecordingsOpen(true)}>Recordings</button>
        </div>
      </header>

      {clients.length === 0 && (
        <div className="empty">
          <h2>No clients connected</h2>
          <p>Install the ViewLocal client on machines in your LAN. They will appear here.</p>
        </div>
      )}

      {view === 'tiles' && clients.length > 0 && (
        <div className="grid">
          {filtered.map((c) => {
            const f = frames[c.id];
            const rec = activeRecordings[c.id];
            return (
              <div key={c.id} className={`tile ${rec ? 'tile-rec' : ''}`} onClick={() => setSelectedId(c.id)}>
                <FrameImg frame={f} className="tile-img" />
                {rec && <div className="rec-badge">⏺ REC</div>}
                <div className="tile-meta">
                  <div className="tile-title">{c.hostname}</div>
                  <div className="tile-sub">
                    {c.username && <span>{c.username}</span>}
                    <span>{c.os}</span>
                    <span className={f && Date.now() - f.ts < 3000 ? 'live' : 'stale'}>{formatAgo(f?.ts)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'list' && clients.length > 0 && (
        <table className="list">
          <thead>
            <tr>
              <th>Preview</th>
              <th>Hostname</th>
              <th>User</th>
              <th>OS</th>
              <th>Resolution</th>
              <th>Version</th>
              <th>Last frame</th>
              <th>Record</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const f = frames[c.id];
              const rec = activeRecordings[c.id];
              return (
                <tr key={c.id}>
                  <td className="list-preview">
                    <FrameImg frame={f} className="list-img" />
                  </td>
                  <td>{c.hostname}</td>
                  <td>{c.username || '—'}</td>
                  <td>{c.os || '—'}</td>
                  <td>{c.screenWidth && c.screenHeight ? `${c.screenWidth}×${c.screenHeight}` : '—'}</td>
                  <td>{c.version || '—'}</td>
                  <td className={f && Date.now() - f.ts < 3000 ? 'live' : 'stale'}>{formatAgo(f?.ts)}</td>
                  <td>
                    <button className={`btn ${rec ? 'btn-rec-active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleRecord(c.id); }}>
                      {rec ? `⏺ Stop (${rec.frameCount || 0})` : 'Record'}
                    </button>
                  </td>
                  <td>
                    <button className="btn" onClick={() => setSelectedId(c.id)}>View</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelectedId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <b>{selected.hostname}</b>
                <span className="sub">  {selected.username || ''}  {selected.os}  ·  v{selected.version || '?'}  ·  {selected.screenWidth}×{selected.screenHeight}</span>
              </div>
              <div className="modal-head-actions">
                <button
                  className={`btn ${selectedRec ? 'btn-rec-active' : 'btn-rec'}`}
                  onClick={() => toggleRecord(selected.id)}
                >
                  {selectedRec
                    ? `⏺ Stop recording (${selectedRec.frameCount || 0} frames · ${formatDuration(Date.now() - selectedRec.startedAt)})`
                    : '⚫ Record'}
                </button>
                <button className="btn close" onClick={() => setSelectedId(null)}>✕</button>
              </div>
            </div>
            <div className="modal-body">
              <FrameImg frame={selectedFrame} className="modal-img" />
            </div>
            <div className="modal-foot">Last frame: {formatAgo(selectedFrame?.ts)} · Press Esc to close</div>
          </div>
        </div>
      )}

      {recordingsOpen && (
        <div className="modal-backdrop" onClick={() => setRecordingsOpen(false)}>
          <div className="modal rec-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div><b>Recordings</b> <span className="sub">saved on this server</span></div>
              <div className="modal-head-actions">
                <button className="btn" onClick={loadRecordings} disabled={recordingsLoading}>{recordingsLoading ? '…' : 'Refresh'}</button>
                <button className="btn close" onClick={() => setRecordingsOpen(false)}>✕</button>
              </div>
            </div>
            {recordingsInfo && (
              <div className="rec-info">
                <span className="rec-info-label">Folder:</span>
                <code className="rec-info-path" title={recordingsInfo.dir}>{recordingsInfo.dir}</code>
                <span className="rec-info-meta">
                  {recordingsInfo.count} {recordingsInfo.count === 1 ? 'file' : 'files'} · {formatBytes(recordingsInfo.totalBytes || 0)}
                  {recordingsInfo.ffmpeg ? '' : ' · ⚠ ffmpeg missing'}
                </span>
                <span className="rec-info-hint">To change, use tray menu → Change recordings folder…</span>
              </div>
            )}
            <div className="modal-body rec-body">
              {recordingsList.length === 0 ? (
                <div className="empty" style={{ padding: 40 }}>
                  <p>No recordings yet. Open a client, press ⚫ Record to capture.</p>
                </div>
              ) : (
                <table className="list rec-list">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Size</th>
                      <th>Created</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recordingsList.map((r) => (
                      <tr key={r.name}>
                        <td><a className="rec-link" href={r.url} target="_blank" rel="noreferrer">{r.name}</a></td>
                        <td>{formatBytes(r.size)}</td>
                        <td>{formatDateTime(r.mtime)}</td>
                        <td className="rec-actions">
                          <a className="btn" href={r.url} download>Download</a>
                          <a className="btn" href={r.url} target="_blank" rel="noreferrer">Play</a>
                          <button className="btn btn-danger" onClick={() => deleteRecording(r.name)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.kind}`}>{toast.msg}</div>
      )}
    </div>
  );
}
