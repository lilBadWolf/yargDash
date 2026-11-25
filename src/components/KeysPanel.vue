<script setup>
// A keyboard part falling onto piano keys, in time with the song (Synthesia-style): the chart's Pro Keys, or a
// Guitar Pro piano/organ/synth track laid onto the song like the tabs. Notes fall onto the keys that play them;
// a key lights up in the hand's colour while its note sounds (right hand teal, left hand purple: the Guitar Pro
// grand staff's lower staff, or below middle C when the part doesn't say). The keyboard spans the part's range.
// Pro Keys: the 17-key window Rock Band shows the player is marked, and moves with the chart.
// Drawn on a canvas each frame; only the notes inside the visible window are touched.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { yarg, songTime, fetchTabTrack } from '../lib/yarg.js';
import { settings } from '../lib/settings.js';

const props = defineProps({ trackId: { type: String, default: null } });

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
// black keys sit a little off the line between their white keys, as on a piano (in white-key widths)
const NUDGE = { 1: -0.1, 3: 0.1, 6: -0.12, 8: 0, 10: 0.12 };
const HAND = [
  { fill: '#3dd6c6', dark: '#1d9e92', glow: '#3dd6c6', key: '#7ff0e4', keyDark: '#178a7f' }, // right
  { fill: '#b48cff', dark: '#7d55d6', glow: '#b48cff', key: '#d4bcff', keyDark: '#6a44c2' }, // left
];

// ---------- data ----------
const track = ref(null);
const loading = ref(false);
async function load() {
  if (!props.trackId) { track.value = null; return; }
  loading.value = true;
  try {
    const t = await fetchTabTrack(props.trackId);
    if (t) t.maxDur = Math.min(30, Math.max(0, ...t.notes.map((n) => n[1])));
    track.value = t;
  } finally { loading.value = false; }
}
watch(() => [props.trackId, yarg.tabs?.version], load, { immediate: true });

const hand = (n) => (n[3] >= 0 ? n[3] : n[2] < 60 ? 1 : 0);
const twoHands = computed(() => !!track.value?.notes.some((n) => hand(n) === 1) && track.value.notes.some((n) => hand(n) === 0));

// the keys shown: the part's range out to whole white keys, at least two octaves (Pro Keys: its C3-C5)
const range = computed(() => {
  const ns = track.value?.notes || [];
  if (!ns.length) return { lo: 48, hi: 72 };
  if (track.value.ranges) return { lo: 48, hi: 72 };
  let lo = Infinity, hi = -Infinity;
  for (const n of ns) { lo = Math.min(lo, n[2]); hi = Math.max(hi, n[2]); }
  lo -= 1; hi += 1;
  while (hi - lo < 24) { lo--; hi++; }
  lo = Math.max(21, lo); hi = Math.min(108, hi);
  while (lo > 21 && BLACK[lo % 12]) lo--;
  while (hi < 108 && BLACK[hi % 12]) hi++;
  // start on a C or F and end on a B or E when it costs at most a couple of keys: reads like a real keyboard
  for (let i = 0; i < 2 && lo > 21 && lo % 12 !== 0 && lo % 12 !== 5; i++) { lo--; while (BLACK[lo % 12]) lo--; }
  for (let i = 0; i < 2 && hi < 108 && hi % 12 !== 11 && hi % 12 !== 4; i++) { hi++; while (BLACK[hi % 12]) hi++; }
  return { lo, hi };
});

// chord names (Guitar Pro), shown while they last
const chord = ref({ cur: '', next: '' });
function updateChord(t) {
  const cs = track.value?.chords || [];
  let i = -1;
  for (let j = 0; j < cs.length && cs[j][0] <= t + 0.05; j++) i = j;
  const cur = i >= 0 ? cs[i][1] : '', next = cs[i + 1] && cs[i + 1][0] - t < 4 ? cs[i + 1][1] : '';
  if (cur !== chord.value.cur || next !== chord.value.next) chord.value = { cur, next };
}

// ---------- drawing ----------
const canvas = ref(null), box = ref(null);
let raf = 0, lastNow = null, lastFrame = 0;
const sparks = [];
const lowerBound = (a, t) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m][0] < t) lo = m + 1; else hi = m; } return lo; };
function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function draw(frameAt) {
  raf = requestAnimationFrame(draw);
  const cv = canvas.value, el = box.value;
  if (!cv || !el) return;
  const W = el.clientWidth, H = el.clientHeight, dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const tr = track.value;
  if (!tr || W < 50 || H < 80) return;
  const dt = Math.min(0.1, Math.max(0, (frameAt - lastFrame) / 1000 || 0));
  lastFrame = frameAt;

  const t = songTime();
  const now = t == null || !isFinite(t) ? 0 : t;
  updateChord(now);

  // ----- geometry -----
  const { lo, hi } = range.value;
  const whites = [];
  for (let p = lo; p <= hi; p++) if (!BLACK[p % 12]) whites.push(p);
  const ww = W / whites.length;                                    // white key width
  const bw = ww * 0.62;                                            // black key width
  const kbH = Math.round(Math.min(Math.max(H * 0.2, 64), 190, ww * 6.5)); // keyboard height
  const strikeY = H - kbH;
  const bh = kbH * 0.63;                                           // black key height
  const whiteIdx = new Map(whites.map((p, i) => [p, i]));
  const keyX = (p) => (BLACK[p % 12] ? (whiteIdx.get(p - 1) + 1 + (NUDGE[p % 12] || 0)) * ww - bw / 2 : whiteIdx.get(p) * ww);
  const keyW = (p) => (BLACK[p % 12] ? bw : ww);
  const T = 2.4 / (settings.keysSpeed || 1);                       // seconds from the top to the keys
  const pps = strikeY / T;
  const yAt = (time) => strikeY - (time - now) * pps;

  // ----- background: columns, octave lines, beats, sections -----
  const bg = ctx.createLinearGradient(0, 0, 0, strikeY);
  bg.addColorStop(0, '#0b0d10'); bg.addColorStop(1, '#141922');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, strikeY);
  for (let p = lo; p <= hi; p++) {
    if (BLACK[p % 12]) { ctx.fillStyle = '#00000038'; ctx.fillRect(keyX(p), 0, bw, strikeY); }
    else if (p % 12 === 0 || p % 12 === 5) { ctx.fillStyle = p % 12 === 0 ? '#ffffff16' : '#ffffff09'; ctx.fillRect(Math.round(keyX(p)), 0, 1, strikeY); }
  }
  const beats = yarg.lyrics?.beats || [];
  for (let i = lowerBound(beats, now - 0.05); i < beats.length && beats[i][0] < now + T; i++) {
    const [b, k] = beats[i], y = Math.round(yAt(b));
    ctx.fillStyle = k === 0 ? '#ffffff26' : '#ffffff0d';
    ctx.fillRect(0, y - (k === 0 ? 1 : 0), W, k === 0 ? 2 : 1);
  }
  // section names at the right edge (the hand legend and chord sit at the top corners)
  ctx.font = '800 11px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  for (const s of yarg.lyrics?.sections || []) {
    if (s.t < now || s.t > now + T) continue;
    const y = yAt(s.t), lw = Math.min(W, 160);
    ctx.fillStyle = '#3dd6c6'; ctx.fillRect(W - lw, y - 1, lw, 2);
    ctx.fillText(s.name.toUpperCase(), W - 6, y - 4);
  }

  // ----- Pro Keys: the window the player sees -----
  const ranges = tr.ranges || [];
  let curRange = null;
  if (ranges.length) {
    let i = Math.max(0, lowerBound(ranges, now + 1e-6) - 1);
    if (ranges[i][0] > now) i = -1;
    curRange = i >= 0 ? ranges[i] : ranges[0];
    for (let j = Math.max(0, i); j < ranges.length && ranges[j][0] < now + T; j++) {
      const [rt, rlo, rhi] = ranges[j], end = ranges[j + 1] ? ranges[j + 1][0] : Infinity;
      const yTop = Math.max(0, yAt(Math.min(end, now + T))), yBot = Math.min(strikeY, yAt(Math.max(rt, now)));
      if (yBot <= yTop) continue;
      const x0 = keyX(rlo), x1 = keyX(rhi) + keyW(rhi);
      ctx.fillStyle = '#ffd54a0a'; ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop);
      ctx.fillStyle = '#ffd54a55'; ctx.fillRect(Math.round(x0), yTop, 2, yBot - yTop); ctx.fillRect(Math.round(x1) - 2, yTop, 2, yBot - yTop);
    }
  }

  // ----- falling notes -----
  const notes = tr.notes;
  const from = lowerBound(notes, now - (tr.maxDur || 0) - 0.1), to = lowerBound(notes, now + T);
  const active = new Map();                                        // pitch -> { hand, since }
  const radius = Math.min(6, ww * 0.18);
  const label = settings.keysNames;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  // white-key notes first, black-key notes on top (they're narrower and sit between)
  for (const blackPass of [0, 1]) {
    for (let i = from; i < to; i++) {
      const n = notes[i], [nt, dur, p] = n;
      if (p < lo || p > hi || BLACK[p % 12] !== blackPass) continue;
      const end = nt + Math.max(dur, 0.06);
      if (end < now) continue;
      const h = hand(n), c = HAND[h];
      const on = nt <= now && now < nt + Math.max(dur, 0.12);
      if (on) { const a = active.get(p); if (!a || a.since < nt) active.set(p, { hand: h, since: nt }); }
      const kw = keyW(p), w = blackPass ? kw * 0.92 : kw * 0.84, x = keyX(p) + (kw - w) / 2;
      let yb = yAt(nt), yt = yAt(end);
      yb = Math.min(yb, strikeY);                                   // eaten by the key while it sounds
      if (yb - yt < 5) yt = yb - 5;
      if (yb < 0) continue;
      const g = ctx.createLinearGradient(x, yt, x + w, yt);
      const base = blackPass ? c.dark : c.fill;
      g.addColorStop(0, base); g.addColorStop(0.5, blackPass ? c.fill : c.key); g.addColorStop(1, base);
      if (on) { ctx.shadowColor = c.glow; ctx.shadowBlur = 16; }
      rrect(ctx, x, yt, w, yb - yt, radius);
      ctx.fillStyle = g; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = on ? '#ffffffcc' : '#00000066'; ctx.lineWidth = on ? 1.5 : 1; ctx.stroke();
      // note name at the bottom of the note, when it fits
      if (label && w >= 13 && yb - yt >= 16) {
        const fs = Math.min(13, Math.floor(w * 0.55));
        ctx.font = `800 ${fs}px -apple-system, system-ui, sans-serif`;
        ctx.fillStyle = '#071012cc';
        ctx.fillText(NAMES[p % 12].replace('♯', w >= 20 ? '♯' : '#'), x + w / 2, yb - 3);
      }
    }
  }

  // ----- sparks where notes land -----
  if (lastNow !== null && now > lastNow && now - lastNow < 0.25) {
    for (let i = lowerBound(notes, lastNow + 1e-6); i < notes.length && notes[i][0] <= now; i++) {
      const n = notes[i], p = n[2];
      if (p < lo || p > hi || sparks.length > 500) continue;
      const cx = keyX(p) + keyW(p) / 2, col = HAND[hand(n)].key;
      for (let k = 0; k < 7; k++) sparks.push({ x: cx + (Math.random() - 0.5) * keyW(p) * 0.6, y: strikeY - 2, vx: (Math.random() - 0.5) * 90, vy: -60 - Math.random() * 170, life: 0.35 + Math.random() * 0.4, age: 0, col });
    }
  }
  lastNow = now;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.age += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 260 * dt;
    if (s.age >= s.life || s.y > strikeY) { sparks.splice(i, 1); continue; }
    ctx.globalAlpha = 1 - s.age / s.life; ctx.fillStyle = s.col;
    ctx.beginPath(); ctx.arc(s.x, s.y, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  // glow over the keys that are sounding
  for (const [p, a] of active) {
    const cx = keyX(p) + keyW(p) / 2, fresh = Math.max(0, 1 - (now - a.since) / 0.3);
    const r = keyW(p) * (1.3 + fresh * 1.2);
    const g = ctx.createRadialGradient(cx, strikeY, 0, cx, strikeY, r);
    g.addColorStop(0, HAND[a.hand].glow + (fresh > 0.2 ? 'cc' : '88')); g.addColorStop(1, '#00000000');
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(cx - r, strikeY - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

  // ----- keyboard -----
  ctx.fillStyle = '#07080a'; ctx.fillRect(0, strikeY, W, kbH);
  const press = Math.max(1.5, kbH * 0.02);
  for (const p of whites) {
    const x = keyX(p), a = active.get(p), y = strikeY + 3 + (a ? press : 0);
    const g = ctx.createLinearGradient(0, y, 0, H);
    if (a) { g.addColorStop(0, HAND[a.hand].key); g.addColorStop(1, HAND[a.hand].fill); }
    else { g.addColorStop(0, '#d9dbde'); g.addColorStop(0.12, '#f6f6f3'); g.addColorStop(1, '#e4e4e0'); }
    rrect(ctx, x + 0.5, y, ww - 1, H - y - 1, Math.min(5, ww * 0.15));
    ctx.fillStyle = g; ctx.fill();
    if (curRange && (p < curRange[1] || p > curRange[2])) { ctx.fillStyle = '#00000055'; ctx.fill(); }
    // C labels, and the name of a key while it sounds
    if (ww >= 11 && (p % 12 === 0 || (a && label))) {
      ctx.font = `${a ? 800 : 700} ${Math.round(Math.min(12, ww * 0.42))}px -apple-system, system-ui, sans-serif`;
      ctx.fillStyle = a ? '#071012' : '#8a919b'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(p % 12 === 0 && !a ? `C${Math.floor(p / 12) - 1}` : NAMES[p % 12], x + ww / 2, H - 6);
    }
  }
  for (let p = lo; p <= hi; p++) {
    if (!BLACK[p % 12]) continue;
    const x = keyX(p), a = active.get(p), y = strikeY + 2;
    const g = ctx.createLinearGradient(0, y, 0, y + bh);
    if (a) { g.addColorStop(0, HAND[a.hand].dark); g.addColorStop(1, HAND[a.hand].keyDark); }
    else { g.addColorStop(0, '#30343b'); g.addColorStop(0.85, '#121418'); g.addColorStop(1, '#22262c'); }
    rrect(ctx, x, y + (a ? press * 0.6 : 0), bw, bh, Math.min(3, bw * 0.15));
    ctx.fillStyle = g; ctx.fill();
    if (!a) { ctx.fillStyle = '#ffffff14'; ctx.fillRect(x + bw * 0.18, y + 3, bw * 0.64, bh * 0.75); }
    if (curRange && (p < curRange[1] || p > curRange[2])) { rrect(ctx, x, y, bw, bh, 2); ctx.fillStyle = '#00000066'; ctx.fill(); }
  }
  // the felt strip the notes land on
  const felt = ctx.createLinearGradient(0, strikeY - 2, 0, strikeY + 4);
  felt.addColorStop(0, '#3dd6c600'); felt.addColorStop(0.5, '#3dd6c6'); felt.addColorStop(1, '#14312e');
  ctx.fillStyle = felt; ctx.fillRect(0, strikeY - 2, W, 5);
}

onMounted(() => { raf = requestAnimationFrame(draw); });
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <div ref="box" class="keys">
    <canvas ref="canvas" />
    <div v-if="track && (chord.cur || chord.next)" class="chord">
      <b>{{ chord.cur }}</b><span v-if="chord.next">then {{ chord.next }}</span>
    </div>
    <div v-if="track" class="legend">
      <template v-if="twoHands"><i class="r" />Right <i class="l" />Left</template>
      <template v-if="track.ranges?.length"><i class="w" />Pro Keys window</template>
    </div>
    <div v-if="loading && !track" class="msg">Loading…</div>
  </div>
</template>

<style scoped>
.keys { position: relative; height: 100%; min-height: 0; border-radius: 10px; overflow: hidden; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.msg { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); }
.chord { position: absolute; top: 8px; right: 8px; display: flex; flex-direction: column; align-items: flex-end; padding: 4px 10px 6px; border-radius: 10px; background: #0b0d10d0; pointer-events: none; }
.chord b { font-size: clamp(22px, 4vw, 40px); font-weight: 900; color: var(--solo); line-height: 1.05; }
.chord span { font-size: 13px; color: var(--muted); }
.legend { position: absolute; top: 8px; left: 8px; display: flex; align-items: center; gap: 5px; padding: 4px 9px 4px 3px; border-radius: 8px; background: #0b0d10d0; font-size: 11px; font-weight: 700; color: var(--muted); pointer-events: none; }
.legend:empty { display: none; }
.legend i { width: 10px; height: 10px; border-radius: 3px; margin-left: 6px; }
.legend .r { background: #3dd6c6; } .legend .l { background: #b48cff; } .legend .w { background: #ffd54a88; }
</style>
