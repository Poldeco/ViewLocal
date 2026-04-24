import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const socketUrl = window.location.origin;

function useSocket() {
  const [clients, setClients] = useState([]);
  const [frames, setFrames] = useState({});
  const [connected, setConnected] = useState(false);

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
    });
    return () => socket.close();
  }, []);

  return { clients, frames, connected };
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

function FrameImg({ frame, className }) {
  if (!frame || !frame.image) {
    return <div className={`frame-empty ${className || ''}`}>No signal</div>;
  }
  const src = frame.image.startsWith('data:') ? frame.image : `data:image/jpeg;base64,${frame.image}`;
  return <img className={className} src={src} alt="screen" />;
}

export default function App() {
  const { clients, frames, connected } = useSocket();
  const [view, setView] = useState('tiles');
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [tick, setTick] = useState(0);

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

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◉</span> ViewLocal
          <span className={`pill ${connected ? 'ok' : 'bad'}`}>{connected ? 'connected' : 'offline'}</span>
          <span className="count">{clients.length} {clients.length === 1 ? 'client' : 'clients'}</span>
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
            return (
              <div key={c.id} className="tile" onClick={() => setSelectedId(c.id)}>
                <FrameImg frame={f} className="tile-img" />
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const f = frames[c.id];
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
              <button className="btn close" onClick={() => setSelectedId(null)}>✕</button>
            </div>
            <div className="modal-body">
              <FrameImg frame={selectedFrame} className="modal-img" />
            </div>
            <div className="modal-foot">Last frame: {formatAgo(selectedFrame?.ts)} · Press Esc to close</div>
          </div>
        </div>
      )}
    </div>
  );
}
