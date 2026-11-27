// Effects for the Keys view where notes meet the keys: a burst when a note lands (or you hit the right note), and for
// some a glow that carries on while it sounds (or you hold it). Shared by KeysPanel and the preview in Settings.
//
//   sparks     little embers flying up and falling back (the original)
//   flames     fire licking up from the key while it's down
//   beams      a column of light rising from the key
//   ripples    rings spreading out along the keys
//   fireworks  a starburst with trails
//
// amount scales how drastic: how many, how big, how far (0.25 subtle … 3 wild).
// Colours: the hand's colour, real fire colours, or a rainbow by pitch.

export const FX = [
  ['sparks', 'Sparks'], ['flames', 'Flames'], ['beams', 'Beams'], ['ripples', 'Ripples'], ['fireworks', 'Fireworks'], ['none', 'None'],
];
export const FX_COLOURS = [['hand', 'Hand colours'], ['fire', 'Fire'], ['rainbow', 'Rainbow']];

const MAX = 1800;
const hex = (c) => { const n = parseInt(c.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, f) => a.map((x, i) => Math.round(x + (b[i] - x) * f));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const FIRE = [[255, 250, 220], [255, 214, 90], [255, 140, 30], [230, 60, 15], [120, 20, 10]];
const hsl2rgb = (h, s, l) => {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
};

// a soft round sprite per colour, drawn once (radial gradients per particle per frame are too slow)
const sprites = new Map();
function sprite(c) {
  const key = c.join(',');
  let s = sprites.get(key);
  if (s) return s;
  s = document.createElement('canvas');
  s.width = s.height = 64;
  const g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${key},1)`); gr.addColorStop(0.35, `rgba(${key},.55)`); gr.addColorStop(1, `rgba(${key},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  if (sprites.size > 400) sprites.clear();
  sprites.set(key, s);
  return s;
}
// a colour ramp from hot (white) to the colour to dark, in 6 steps (so sprites can be cached)
function ramp(base, palette) {
  if (palette === 'fire') return FIRE;
  const c = base;
  return [mix(c, [255, 255, 255], 0.6), mix(c, [255, 255, 255], 0.25), c, mix(c, [0, 0, 0], 0.3), mix(c, [0, 0, 0], 0.6)];
}
const at = (r, f) => r[Math.min(r.length - 1, Math.max(0, Math.floor(f * r.length)))];

export function createFx() {
  const ps = [];
  const add = (p) => { if (ps.length < MAX) ps.push(p); };

  // the colour for a key: the hand's (a hex string), or by palette
  function colour(handCol, pitch, palette) {
    if (palette === 'rainbow') return hsl2rgb(((pitch * 29) % 360 + 360) % 360, 0.9, 0.62);
    if (palette === 'fire') return FIRE[1];
    return hex(handCol);
  }

  // A note landing / a right note played: x, w the key, y the top of the keys
  function burst(kind, { x, w, y, col, pitch = 60, palette = 'hand', amt = 1 }) {
    if (kind === 'none' || amt <= 0) return;
    const c = colour(col, pitch, palette), r = ramp(c, palette), sq = Math.sqrt(amt);
    const cx = x + w / 2;
    if (kind === 'sparks') {
      const n = Math.round(7 * amt);
      for (let k = 0; k < n; k++) add({ k: 's', x: cx + (Math.random() - 0.5) * w * 0.6, y: y - 2, vx: (Math.random() - 0.5) * 90 * sq, vy: -60 - Math.random() * 170 * sq,
        life: 0.35 + Math.random() * 0.4 * sq, age: 0, size: 1.6 * (0.7 + 0.3 * amt), c: palette === 'fire' ? at(FIRE, Math.random() * 0.6) : c });
    } else if (kind === 'flames') {
      const n = Math.round(16 * amt);
      for (let k = 0; k < n; k++) flame(cx, w, y, r, amt, 1.25);
    } else if (kind === 'beams') {
      add({ k: 'b', x, w, y, life: 0.35 * (0.7 + 0.3 * amt), age: 0, h: Math.min(0.95, 0.45 * sq), c, a: 0.8 });
    } else if (kind === 'ripples') {
      for (let k = 0; k < (amt > 1.5 ? 3 : 2); k++) add({ k: 'r', x: cx, y, w, life: 0.55 * (0.8 + 0.2 * amt), age: -k * 0.09, grow: 2.2 * amt + 0.6, c });
      add({ k: 'f', x: cx, y, w, life: 0.18, age: 0, c: mix(c, [255, 255, 255], 0.6), size: w * 1.6 * sq }); // flash
    } else if (kind === 'fireworks') {
      const n = Math.round(26 * amt);
      add({ k: 'f', x: cx, y: y - 8, w, life: 0.25, age: 0, c: mix(c, [255, 255, 255], 0.7), size: Math.min(w, 26) * 2.2 * sq });
      for (let k = 0; k < n; k++) {
        const ang = -Math.PI * (0.05 + Math.random() * 0.9), sp = (150 + Math.random() * 220) * sq;
        const cc = palette === 'rainbow' ? hsl2rgb(Math.random() * 360, 0.9, 0.65) : mix(c, [255, 255, 255], Math.random() * 0.5);
        add({ k: 'w', x: cx, y: y - 8, px: cx, py: y - 8, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0.6 + Math.random() * 0.5 * sq, age: 0,
          size: 1.6 + 0.5 * amt, c: cc, tw: Math.random() * 6 });
      }
    }
  }

  function flame(cx, w, y, r, amt, boost = 1) {
    const sq = Math.sqrt(amt);
    add({ k: 'fl', x: cx + (Math.random() - 0.5) * w * 0.6, y: y - 1, vx: (Math.random() - 0.5) * 14, vy: -(90 + Math.random() * 140) * sq * boost,
      life: (0.25 + Math.random() * 0.35) * (0.8 + 0.2 * amt), age: 0, size: Math.min(w, 26) * (0.2 + Math.random() * 0.16) * (0.75 + 0.25 * amt), r, wob: Math.random() * 6 });
  }

  // Carries on while a key sounds / is held (flames and beams; the rest are one burst)
  function sustain(kind, { x, w, y, col, pitch = 60, palette = 'hand', amt = 1 }, dt) {
    if (amt <= 0 || (kind !== 'flames' && kind !== 'beams')) return;
    const c = colour(col, pitch, palette);
    if (kind === 'flames') {
      const r = ramp(c, palette);
      let n = 80 * amt * dt;
      while (n > 0) { if (Math.random() < n) flame(x + w / 2, w, y, r, amt); n -= 1; }
    } else {
      add({ k: 'b', x, w, y, life: 0.12, age: 0, h: Math.min(0.9, 0.35 * Math.sqrt(amt)) * (0.9 + Math.random() * 0.2), c, a: 0.22 });
    }
  }

  function draw(ctx, dt, floorY) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age < 0) continue;
      const f = p.age / p.life;
      if (f >= 1) { ps.splice(i, 1); continue; }
      if (p.k === 's') {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt;
        if (p.y > floorY) { ps.splice(i, 1); continue; }
        ctx.globalAlpha = 1 - f; ctx.fillStyle = rgb(p.c);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      } else if (p.k === 'fl') {
        p.wob += dt * 9;
        p.x += (p.vx + Math.sin(p.wob) * 22) * dt; p.y += p.vy * dt; p.vy *= 1 - 0.6 * dt;
        const s = p.size * (1 - f * 0.6);
        ctx.globalAlpha = Math.min(1, (1 - f) * 1.5) * 0.6;
        ctx.drawImage(sprite(at(p.r, f)), p.x - s, p.y - s * 1.8, s * 2, s * 3.6); // tall and thin: a tongue of flame
      } else if (p.k === 'b') {
        const a = (1 - f) * p.a, h = p.h * p.y * (0.6 + 0.4 * (1 - f)); // h: a share of the space above the keys
        const g = ctx.createLinearGradient(0, p.y, 0, p.y - h);
        g.addColorStop(0, `rgba(${p.c.join(',')},${a})`); g.addColorStop(1, `rgba(${p.c.join(',')},0)`);
        ctx.globalAlpha = 1; ctx.fillStyle = g;
        ctx.fillRect(p.x + p.w * 0.12, p.y - h, p.w * 0.76, h);
        const core = ctx.createLinearGradient(0, p.y, 0, p.y - h * 0.8);
        core.addColorStop(0, `rgba(255,255,255,${a * 0.45})`); core.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = core;
        ctx.fillRect(p.x + p.w * 0.42, p.y - h * 0.8, p.w * 0.16, h * 0.8);
      } else if (p.k === 'r') {
        const rx = p.w * (0.4 + p.grow * f), ry = Math.max(2, rx * 0.22);
        ctx.globalAlpha = (1 - f) * 0.9; ctx.strokeStyle = rgb(p.c); ctx.lineWidth = Math.max(0.5, 3 * (1 - f));
        ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (p.k === 'f') {
        const s = p.size * (0.6 + f * 0.6);
        ctx.globalAlpha = (1 - f) * 0.9;
        ctx.drawImage(sprite(p.c), p.x - s, p.y - s, s * 2, s * 2);
      } else if (p.k === 'w') {
        p.px = p.x; p.py = p.y;
        p.vx *= 1 - 1.6 * dt; p.vy = p.vy * (1 - 1.6 * dt) + 140 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const tw = 0.6 + 0.4 * Math.sin(p.age * 30 + p.tw);
        ctx.globalAlpha = (1 - f) * tw; ctx.strokeStyle = rgb(p.c); ctx.lineWidth = p.size; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x - p.vx * 0.07, p.y - p.vy * 0.07); ctx.lineTo(p.x, p.y); ctx.stroke();
        const g = p.size * 3.5;
        ctx.drawImage(sprite(p.c), p.x - g, p.y - g, g * 2, g * 2);
      }
    }
    ctx.restore();
  }

  return { burst, sustain, draw, clear: () => { ps.length = 0; }, count: () => ps.length };
}
