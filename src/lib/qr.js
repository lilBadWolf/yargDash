// Shareable links (QR codes) for performer pages, using an address phones can reach.
import { encode } from 'uqr';
import { settings } from './settings.js';
import { conn } from './conn.js';

const LOCAL = /^(localhost|127\.|\[?::1\]?$|0\.0\.0\.0)/;

export function shareHost() {
  if (settings.qrHost) return settings.qrHost.trim();
  // already opened via a network address? use it as is
  if (location.hostname && !LOCAL.test(location.hostname)) return location.host;
  const ip = conn.lan[0]?.ip;
  return ip ? `${ip}${location.port ? `:${location.port}` : ''}` : location.host;
}
export function pageUrl(hash) {
  return `${location.protocol}//${shareHost()}${location.pathname}${hash}`;
}

// QR as an SVG path (1 unit per module) with a 3-module quiet zone.
export function qrSvg(text) {
  const { size, data } = encode(text, { ecc: 'M' });
  const q = 3, n = size + q * 2;
  let d = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y][x]) d += `M${x + q} ${y + q}h1v1h-1z`;
  return { viewBox: `0 0 ${n} ${n}`, d };
}
