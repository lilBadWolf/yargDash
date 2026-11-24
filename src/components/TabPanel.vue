<script setup>
// Tablature in time: a page of bars (like a printed tab), the chart's bar lines and sections, a cursor moving
// through the current bar, and the page scrolling so the current row stays near the top. Notes that are sounding
// light up. Drawn on a canvas each frame (only the rows on screen). Scroll/drag by hand to look around; it
// goes back to following after a few seconds.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { yarg, songTime, fetchTabTrack } from '../lib/yarg.js';
import { settings } from '../lib/settings.js';

const props = defineProps({ trackId: { type: String, default: null } });
const F = { MUTED: 1, GHOST: 2, BEND: 4, HARMONIC: 8, HAMMER: 16, SLIDE: 32, TIE: 64, PALM: 128, TAP: 256 };
const NOTE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

const track = ref(null);
const loading = ref(false);
async function load() {
  if (!props.trackId) { track.value = null; return; }
  loading.value = true;
  try { track.value = await fetchTabTrack(props.trackId); } finally { loading.value = false; }
}
watch(() => [props.trackId, yarg.tabs?.version], load, { immediate: true });

// chart bar lines (+ the end of the last bar)
const bars = computed(() => {
  const b = (yarg.lyrics?.beats || []).filter(([, k]) => k === 0).map(([t]) => t);
  if (b.length >= 2) b.push(b[b.length - 1] + (b[b.length - 1] - b[b.length - 2]));
  return b;
});
const barAt = (t) => {
  const b = bars.value;
  let lo = 0, hi = b.length - 2;
  if (hi < 0 || t < b[0]) return -1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m] <= t) lo = m; else hi = m - 1; }
  return lo;
};
// notes / chords / sections grouped by bar, with their position inside it (0..1)
const byBar = computed(() => {
  const t = track.value, b = bars.value, out = new Map();
  if (!t || b.length < 2) return out;
  const group = (i) => { if (!out.has(i)) out.set(i, { notes: [], chords: [], secs: [] }); return out.get(i); };
  const frac = (time, i) => Math.min(1, Math.max(0, (time - b[i]) / (b[i + 1] - b[i])));
  for (const n of t.notes) { const i = barAt(n[0]); if (i >= 0) group(i).notes.push({ n, f: frac(n[0], i) }); }
  for (const c of t.chords || []) { const i = barAt(c[0]); if (i >= 0) group(i).chords.push({ name: c[1], f: frac(c[0], i) }); }
  for (const s of yarg.lyrics?.sections || []) { const i = barAt(s.t + 0.05); if (i >= 0) group(i).secs.push(s.name); }
  return out;
});
// how busy a bar gets (90th percentile of distinct note times per bar): busy parts get wider bars
const density = computed(() => {
  const counts = [...byBar.value.values()].map((g) => new Set(g.notes.map(({ n }) => n[0])).size).filter(Boolean).sort((a, b) => a - b);
  return counts.length ? counts[Math.floor(counts.length * 0.9)] : 4;
});
const stringNames = computed(() => (track.value?.tuning || []).map((m, i, a) => (i === a.length - 1 && a.length >= 6 ? NOTE[m % 12].toLowerCase() : NOTE[m % 12])));

const canvas = ref(null), box = ref(null);
let raf = 0, scrollY = 0, userUntil = 0, drag = null;
const L = { W: 0, H: 0, bpr: 4, rowH: 120, gap: 18, head: 34, left: 26, barW: 100 };

function layout() {
  const W = box.value?.clientWidth || 0, H = box.value?.clientHeight || 0;
  const k = settings.tabScale || 1;
  const strings = track.value?.strings || 6;
  L.W = W; L.H = H;
  L.gap = Math.round(17 * k);
  L.head = Math.round(32 * k);
  L.left = Math.round(26 * k);
  const minBar = Math.min(380, Math.max(140, density.value * 18 + 40)) * k;
  L.bpr = Math.max(1, Math.min(8, Math.floor((W - L.left - 8) / minBar)));
  L.barW = (W - L.left - 8) / L.bpr;
  L.rowH = L.head + (strings - 1) * L.gap + Math.round(26 * k);
}

function draw() {
  raf = requestAnimationFrame(draw);
  const cv = canvas.value, t = track.value;
  if (!cv || !box.value) return;
  layout();
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(L.W * dpr) || cv.height !== Math.round(L.H * dpr)) { cv.width = Math.round(L.W * dpr); cv.height = Math.round(L.H * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, L.W, L.H);
  if (!t || bars.value.length < 2) return;

  const css = getComputedStyle(cv);
  const C = { text: css.getPropertyValue('--text'), muted: css.getPropertyValue('--muted'), accent: css.getPropertyValue('--accent'), line: '#3a424e', bg: css.getPropertyValue('--panel'), solo: css.getPropertyValue('--solo') };
  const k = settings.tabScale || 1;
  const nBars = bars.value.length - 1, rows = Math.ceil(nBars / L.bpr), strings = t.strings;
  const now = songTime();
  const cb = now == null || !isFinite(now) ? -1 : barAt(now);

  // follow: current row near the top (a sliver of the previous row above it)
  const maxY = Math.max(0, rows * L.rowH - L.H + 20);
  if (cb >= 0 && performance.now() > userUntil) {
    const target = Math.min(maxY, Math.max(0, Math.floor(cb / L.bpr) * L.rowH - Math.round(L.rowH * 0.18)));
    scrollY += (target - scrollY) * 0.14;
    if (Math.abs(target - scrollY) < 0.5) scrollY = target;
  }
  scrollY = Math.min(maxY, Math.max(0, scrollY));

  const first = Math.max(0, Math.floor(scrollY / L.rowH)), last = Math.min(rows - 1, Math.floor((scrollY + L.H) / L.rowH));
  ctx.textBaseline = 'middle';
  for (let r = first; r <= last; r++) {
    const top = r * L.rowH - scrollY, staffTop = top + L.head, staffBot = staffTop + (strings - 1) * L.gap;
    const x0 = L.left, x1 = L.left + Math.min(L.bpr, nBars - r * L.bpr) * L.barW;
    const rightEdge = new Array(strings).fill(-Infinity); // per string: where the last fret number ended (avoid overlaps)
    // current bar background
    if (cb >= 0 && Math.floor(cb / L.bpr) === r) {
      ctx.fillStyle = '#3dd6c60c';
      ctx.fillRect(L.left + (cb % L.bpr) * L.barW, staffTop - 8, L.barW, staffBot - staffTop + 16);
    }
    // string names + lines
    ctx.font = `600 ${Math.round(11 * k)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    for (let s = 0; s < strings; s++) {
      const y = staffTop + (strings - 1 - s) * L.gap;
      ctx.fillStyle = C.muted; ctx.fillText(stringNames.value[s] || '', L.left / 2, y);
      ctx.fillStyle = C.line; ctx.fillRect(x0, Math.round(y), x1 - x0, 1);
    }
    for (let j = 0; j < L.bpr; j++) {
      const bi = r * L.bpr + j;
      if (bi >= nBars) break;
      const bx = L.left + j * L.barW;
      ctx.fillStyle = C.line; ctx.fillRect(Math.round(bx), staffTop, 1, staffBot - staffTop + 1);
      ctx.fillStyle = C.muted; ctx.font = `${Math.round(10 * k)}px -apple-system, system-ui, sans-serif`; ctx.textAlign = 'left';
      ctx.fillText(String(bi + 1), bx + 3, staffBot + 12 * k);
      const g = byBar.value.get(bi);
      if (!g) continue;
      const nx = (f) => bx + 10 * k + f * (L.barW - 20 * k);
      if (g.secs.length) {
        ctx.fillStyle = C.accent; ctx.font = `800 ${Math.round(11 * k)}px -apple-system, system-ui, sans-serif`;
        ctx.fillText(g.secs[0].toUpperCase(), bx + 18 * k, top + 9 * k);
      }
      ctx.font = `700 ${Math.round(12 * k)}px -apple-system, system-ui, sans-serif`; ctx.fillStyle = C.solo;
      for (const c of g.chords) ctx.fillText(c.name, nx(c.f) - 4, top + 22 * k);
      // sustains, then fret numbers
      const span = bars.value[bi + 1] - bars.value[bi];
      for (const { n, f } of g.notes) {
        const [nt, dur, s] = n;
        if (dur < 0.35) continue;
        const y = staffTop + (strings - 1 - s) * L.gap;
        const xe = Math.min(bx + L.barW - 4, nx(Math.min(1, f + dur / span)));
        const active = now != null && now >= nt && now < nt + dur;
        ctx.fillStyle = active ? '#3dd6c699' : '#ffffff22';
        ctx.fillRect(nx(f) + 6 * k, y - 1.5, Math.max(0, xe - nx(f) - 6 * k), 3);
      }
      ctx.textAlign = 'center';
      for (const { n, f } of g.notes) {
        const [nt, dur, s, fret, fl] = n;
        if (fl & F.TIE) continue;
        const y = staffTop + (strings - 1 - s) * L.gap;
        let x = nx(f);
        let label = fl & F.MUTED ? 'x' : String(fret);
        if (fl & F.HARMONIC) label = `<${label}>`;
        else if (fl & F.GHOST) label = `(${label})`;
        if (fl & F.BEND) label += 'b';
        if (fl & F.SLIDE) label += '/';
        if (fl & F.HAMMER) label = `h${label}`;
        const active = now != null && now >= nt - 0.02 && now < nt + Math.max(dur, 0.15);
        const past = now != null && !active && now > nt;
        // fast runs: if this number would run into the previous one on the same string, draw it smaller and nudge it right
        const font = (px) => `${active ? 800 : 700} ${Math.round(px * k)}px -apple-system, system-ui, sans-serif`;
        ctx.font = font(active ? 15 : 13);
        let w = ctx.measureText(label).width + 4;
        if (x - w / 2 < rightEdge[s]) {
          ctx.font = font(active ? 12 : 10.5);
          w = ctx.measureText(label).width + 2;
          x = Math.max(x, rightEdge[s] + w / 2);
        }
        rightEdge[s] = x + w / 2;
        ctx.fillStyle = C.bg; ctx.fillRect(x - w / 2, y - 7 * k, w, 14 * k);
        ctx.fillStyle = active ? C.accent : past ? '#7d879488' : C.text;
        ctx.fillText(label, x, y + 0.5);
        if (fl & F.PALM) { ctx.font = `${Math.round(9 * k)}px -apple-system, system-ui, sans-serif`; ctx.fillStyle = C.muted; ctx.fillText('PM', x, staffBot + 11 * k); }
      }
    }
    ctx.fillStyle = C.line; ctx.fillRect(Math.round(x1), staffTop, 1, staffBot - staffTop + 1);
    // cursor
    if (cb >= 0 && Math.floor(cb / L.bpr) === r) {
      const f = (now - bars.value[cb]) / (bars.value[cb + 1] - bars.value[cb]);
      const x = L.left + (cb % L.bpr) * L.barW + 10 * k + f * (L.barW - 20 * k);
      ctx.fillStyle = C.accent; ctx.shadowColor = C.accent; ctx.shadowBlur = 10;
      ctx.fillRect(Math.round(x) - 1, staffTop - 10, 2, staffBot - staffTop + 20);
      ctx.shadowBlur = 0;
    }
  }
}

// manual scrolling (wheel / drag); follow resumes after 4 s
function onWheel(e) { scrollY += e.deltaY; userUntil = performance.now() + 4000; }
function onDown(e) { drag = { y: e.clientY, s: scrollY, id: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId); }
function onMove(e) { if (drag && drag.id === e.pointerId) { scrollY = drag.s - (e.clientY - drag.y); userUntil = performance.now() + 4000; } }
function onUp() { drag = null; }

onMounted(() => { raf = requestAnimationFrame(draw); });
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <div ref="box" class="tab">
    <canvas ref="canvas" @wheel.prevent="onWheel" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" />
    <div v-if="loading && !track" class="msg">Loading tab…</div>
    <div v-else-if="track && bars.length < 2" class="msg">This chart has no bar lines to lay the tab on.</div>
  </div>
</template>

<style scoped>
.tab { position: relative; height: 100%; min-height: 0; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: grab; }
canvas:active { cursor: grabbing; }
.msg { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); }
</style>
