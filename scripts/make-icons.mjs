#!/usr/bin/env node
// Draws yargDash's app icon (a note lane in perspective, notes coming down to the strike line) and writes every
// size the desktop app needs into build/:
//
//   build/icon.svg            the master drawing (src/assets/logo.svg: the same, cropped to its tile, for the page)
//   build/icon.png            1024 px (electron-builder, Linux)
//   build/icon.icns           macOS (made with iconutil, so only on a Mac)
//   build/icon.ico            Windows (16–256 px)
//   electron/assets/          what the running app loads: icon.png (window/Dock from a checkout) and tray*.png, the
//                             menu-bar / tray icons (macOS: black "template" images that follow the menu bar's colour)
//
//   node scripts/make-icons.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build'), ASSETS = path.join(ROOT, 'electron', 'assets');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });

// ---------- the lane, in perspective ----------
// World: lane across u ∈ [-0.5, 0.5], depth z from 1 (strike line, near) to Z_FAR. Screen: x = CX + u·W/z, y = YH + A/z.
const CX = 512, W = 640, Y_NEAR = 840, Y_FAR = 140, Z_FAR = 4.4, Z_NEAR = 0.8; // Z_NEAR: runs off the tile
const A = (Y_NEAR - Y_FAR) / (1 - 1 / Z_FAR), YH = Y_NEAR - A;
const X = (u, z) => CX + (u * W) / z, Y = (z) => YH + A / z;
const f = (n) => Math.round(n * 10) / 10;
const LANES = ['#3ddc84', '#ff4d5e', '#ffd23f', '#3d9bff', '#ff9b3d']; // green red yellow blue orange
const laneU = (i) => (i - 2) / 5;
const BRAND = '#b48cff';

function note(i, z, { ring = false } = {}) {
  const x = X(laneU(i), z), y = Y(z), rx = (W / 5 / z) * 0.43, ry = rx * 0.46, c = LANES[i];
  if (ring) return `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx * 0.92)}" ry="${f(ry * 0.92)}" fill="#0b0d10" stroke="${c}" stroke-width="${f(rx * 0.24)}"/>`;
  const lift = ry * 0.55; // a short puck: side, then top
  return `<g>
    <ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${c}" filter="url(#dim)"/>
    <rect x="${f(x - rx)}" y="${f(y - lift)}" width="${f(rx * 2)}" height="${f(lift)}" fill="${c}" filter="url(#dim)"/>
    <ellipse cx="${f(x)}" cy="${f(y - lift)}" rx="${f(rx)}" ry="${f(ry)}" fill="${c}"/>
    <ellipse cx="${f(x)}" cy="${f(y - lift)}" rx="${f(rx * 0.48)}" ry="${f(ry * 0.48)}" fill="#fff" opacity="0.92"/>
  </g>`;
}

function iconSvg() {
  const zs = []; for (let z = 1.35; z < Z_FAR; z += 0.45) zs.push(z);
  const frets = zs.map((z) => `<line x1="${f(X(-0.5, z))}" y1="${f(Y(z))}" x2="${f(X(0.5, z))}" y2="${f(Y(z))}" stroke="#fff" stroke-opacity="${f(0.22 / z * 10) / 10}" stroke-width="${f(7 / z)}"/>`).join('');
  const dividers = [1, 2, 3, 4].map((i) => { const u = i / 5 - 0.5; return `<line x1="${f(X(u, Z_NEAR))}" y1="${f(Y(Z_NEAR))}" x2="${f(X(u, Z_FAR))}" y2="${Y_FAR}" stroke="#fff" stroke-opacity="0.07" stroke-width="4"/>`; }).join('');
  const lane = `M${f(X(-0.5, Z_NEAR))} ${f(Y(Z_NEAR))} L${f(X(-0.5, Z_FAR))} ${Y_FAR} L${f(X(0.5, Z_FAR))} ${Y_FAR} L${f(X(0.5, Z_NEAR))} ${f(Y(Z_NEAR))}Z`;
  const edge = (s) => `<line x1="${f(X(s * 0.5, Z_NEAR))}" y1="${f(Y(Z_NEAR))}" x2="${f(X(s * 0.5, Z_FAR))}" y2="${Y_FAR}" stroke="url(#edge)" stroke-width="12" stroke-linecap="round"/>`;
  const zStrike = 1;
  const strike = `<line x1="${f(X(-0.5, zStrike))}" y1="${f(Y(zStrike))}" x2="${f(X(0.5, zStrike))}" y2="${f(Y(zStrike))}" stroke="${BRAND}" stroke-opacity="0.55" stroke-width="10"/>`
    + LANES.map((_, i) => note(i, zStrike, { ring: true })).join('');
  // Notes drawn far to near so nearer ones overlap.
  const notes = [[3, 3.1], [0, 2.4], [2, 1.85], [4, 1.45], [1, 1.17]].map(([i, z]) => note(i, z)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#241a3d"/><stop offset="1" stop-color="#0b0d10"/></linearGradient>
    <linearGradient id="road" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1426" stop-opacity="0"/><stop offset="0.35" stop-color="#1c1630"/><stop offset="1" stop-color="#2a2140"/></linearGradient>
    <linearGradient id="edge" gradientUnits="userSpaceOnUse" x1="0" y1="${Y_FAR}" x2="0" y2="${f(Y(Z_NEAR))}"><stop offset="0" stop-color="${BRAND}" stop-opacity="0"/><stop offset="0.5" stop-color="${BRAND}" stop-opacity="0.8"/><stop offset="1" stop-color="${BRAND}"/></linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset="0.3" stop-color="#fff"/></linearGradient>
    <mask id="far"><rect width="1024" height="1024" fill="url(#fade)"/></mask>
    <filter id="dim"><feColorMatrix type="matrix" values="0.6 0 0 0 0  0 0.6 0 0 0  0 0 0.6 0 0  0 0 0 1 0"/></filter>
    <clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)"/>
  <g clip-path="url(#tile)">
    <g mask="url(#far)">
      <path d="${lane}" fill="url(#road)"/>
      ${dividers}${frets}${edge(-1)}${edge(1)}
    </g>
    ${strike}
    <g mask="url(#far)">${notes}</g>
  </g>
  <rect x="100.5" y="100.5" width="823" height="823" rx="185" fill="none" stroke="#fff" stroke-opacity="0.08" stroke-width="3"/>
</svg>`;
}

// Tray: the lane's outline and two notes, black on transparent (macOS tints template images itself).
function traySvg(color = '#000') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" width="22" height="22">
  <path d="M1.5 21 L7.5 1.5 M20.5 21 L14.5 1.5" stroke="${color}" stroke-width="1.7" stroke-linecap="round" fill="none"/>
  <path d="M9.2 21 L10.2 1.5 M12.8 21 L11.8 1.5" stroke="${color}" stroke-width="0.8" stroke-opacity="0.55" fill="none"/>
  <ellipse cx="6.2" cy="16.2" rx="2.7" ry="1.7" fill="${color}"/>
  <ellipse cx="13.7" cy="9" rx="2" ry="1.25" fill="${color}"/>
  <ellipse cx="9.4" cy="4" rx="1.4" ry="0.9" fill="${color}"/>
</svg>`;
}

const render = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

const icon = iconSvg();
fs.writeFileSync(path.join(OUT, 'icon.svg'), icon);
// the page's logo: the same drawing cropped to its tile (no icon margin)
fs.mkdirSync(path.join(ROOT, 'src', 'assets'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src', 'assets', 'logo.svg'), icon.replace('viewBox="0 0 1024 1024" width="1024" height="1024"', 'viewBox="100 100 824 824"'));
fs.writeFileSync(path.join(OUT, 'icon.png'), render(icon, 1024));
fs.writeFileSync(path.join(ASSETS, 'icon.png'), render(icon, 512));

// Windows .ico: PNG-compressed entries (Vista+).
{
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((s) => render(icon, s));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(s >= 256 ? 0 : s, e); head.writeUInt8(s >= 256 ? 0 : s, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(pngs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([head, ...pngs]));
}

// macOS .icns via iconutil.
if (process.platform === 'darwin') {
  const set = fs.mkdtempSync(path.join(os.tmpdir(), 'yargdash-')) + '/icon.iconset';
  fs.mkdirSync(set);
  for (const s of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(set, `icon_${s}x${s}.png`), render(icon, s));
    fs.writeFileSync(path.join(set, `icon_${s}x${s}@2x.png`), render(icon, s * 2));
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(OUT, 'icon.icns')]);
  fs.rmSync(path.dirname(set), { recursive: true, force: true });
} else console.log('Not on a Mac: kept the existing build/icon.icns');

// Tray icons: macOS template (black + alpha, tinted by the system), Windows/Linux in light grey on the dark taskbar.
fs.writeFileSync(path.join(ASSETS, 'trayTemplate.png'), render(traySvg(), 22));
fs.writeFileSync(path.join(ASSETS, 'trayTemplate@2x.png'), render(traySvg(), 44));
fs.writeFileSync(path.join(ASSETS, 'tray.png'), render(traySvg('#e8e3f5'), 32));

console.log('Wrote', [...fs.readdirSync(OUT).map((f) => `build/${f}`), ...fs.readdirSync(ASSETS).map((f) => `electron/assets/${f}`)].filter((f) => /\/(icon|tray)/.test(f)).join(', '));
