#!/usr/bin/env node
// Regenerate PNG + ICO icons for client and server from the source SVG.
// Usage: node tools/gen-icons.js
// Requires: sharp, png-to-ico (devDeps at repo root).

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const TARGETS = [
  { name: 'client', svg: 'client/build/icon.svg', out: 'client/build' },
  { name: 'server', svg: 'server/build/icon.svg', out: 'server/build' },
];

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function renderPng(svgPath, size) {
  const svg = fs.readFileSync(svgPath);
  return sharp(svg, { density: Math.max(72, size * 3) })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function buildFor({ name, svg, out }) {
  const svgPath = path.resolve(svg);
  if (!fs.existsSync(svgPath)) {
    console.error(`[${name}] svg missing: ${svgPath}`);
    return;
  }
  fs.mkdirSync(path.resolve(out), { recursive: true });

  // Primary PNG used by Electron at runtime (Tray, BrowserWindow icon).
  const main = await renderPng(svgPath, 256);
  fs.writeFileSync(path.join(out, 'icon.png'), main);
  console.log(`[${name}] wrote icon.png (256x256)`);

  // Multi-size ICO for Windows installer + app icon.
  // Cap at 256 — larger frames are non-standard and break some tooling.
  const pngs = await Promise.all(ICO_SIZES.map((s) => renderPng(svgPath, s)));
  const ico = await pngToIco(pngs);
  fs.writeFileSync(path.join(out, 'icon.ico'), ico);
  console.log(`[${name}] wrote icon.ico (${ICO_SIZES.join(',')})`);

  // 512x512 PNG for Linux AppImage and macOS fallback.
  const big = await renderPng(svgPath, 512);
  fs.writeFileSync(path.join(out, 'icon@512.png'), big);
  console.log(`[${name}] wrote icon@512.png`);
}

(async () => {
  for (const t of TARGETS) {
    try { await buildFor(t); }
    catch (e) { console.error(`[${t.name}] failed:`, e.message); process.exitCode = 1; }
  }
})();
