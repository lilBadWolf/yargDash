<script setup>
// Pitch guide: the part's notes scrolling right-to-left past a "now" line, with the note to sing named.
// Notes come from the chart (exact pitches and timing), drawn on a canvas each frame.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { yarg, songTime, noteName } from '../lib/yarg.js';

const props = defineProps({ part: { type: String, default: 'vocals' } });
const notes = computed(() => yarg.lyrics?.parts?.[props.part]?.notes || []);
const range = computed(() => {
  const ps = notes.value.filter((n) => !n[3]).map((n) => n[2]);
  if (!ps.length) return [55, 72];
  const lo = Math.min(...ps), hi = Math.max(...ps);
  return [lo - 2, Math.max(hi + 2, lo + 12)];
});

const canvas = ref(null);
const label = ref({ now: '', next: '', inS: 0 });
const BEHIND = 1, AHEAD = 4; // seconds shown either side of now
let raf = 0, idx = 0;

function draw() {
  raf = requestAnimationFrame(draw);
  const cv = canvas.value;
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const t = songTime();
  const ns = notes.value;
  const [lo, hi] = range.value;
  const nowX = W * (BEHIND / (BEHIND + AHEAD));
  const x = (s) => nowX + ((s - t) / (BEHIND + AHEAD)) * W;
  const y = (p) => H - 6 - ((p - lo) / (hi - lo)) * (H - 12);
  const css = getComputedStyle(cv);

  // octave lines (C) for orientation
  ctx.fillStyle = '#ffffff0d';
  for (let p = Math.ceil(lo / 12) * 12; p <= hi; p += 12) ctx.fillRect(0, Math.round(y(p)), W, 1);
  if (t == null || !isFinite(t)) { setLabel('', '', 0); return; }
  // find first note that hasn't ended (notes are sorted; keep a cursor, rewind on seeks)
  if (idx >= ns.length || (idx > 0 && ns[idx - 1][1] > t - BEHIND)) idx = 0;
  while (idx < ns.length && ns[idx][1] < t - BEHIND) idx++;
  let now = null, next = null;
  const bh = Math.max(5, Math.min(12, (H - 12) / (hi - lo)));
  for (let i = idx; i < ns.length && ns[i][0] < t + AHEAD; i++) {
    const [s, e, p, talky] = ns[i];
    const active = s <= t && t < e;
    if (active) now = ns[i];
    else if (!next && s > t) next = ns[i];
    const x0 = x(s), x1 = Math.max(x(e), x0 + 4), yy = talky ? H / 2 : y(p);
    ctx.fillStyle = talky ? '#ffffff30' : active ? css.getPropertyValue('--accent') : s < t ? '#3dd6c655' : '#b48cffcc';
    ctx.beginPath();
    ctx.roundRect(x0, yy - bh / 2, x1 - x0, bh, bh / 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffffaa';
  ctx.fillRect(Math.round(nowX), 0, 2, H);
  const nm = (n) => (n ? (n[3] ? 'spoken' : noteName(n[2])) : '');
  setLabel(nm(now), nm(next), next ? next[0] - t : 0);
}
function setLabel(now, next, inS) { // only touch Vue when the text changes
  const l = label.value, r = Math.round(inS * 10) / 10;
  if (l.now !== now || l.next !== next || l.inS !== r) label.value = { now, next, inS: r };
}
onMounted(() => { raf = requestAnimationFrame(draw); });
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <div class="pg">
    <div class="names">
      <b :class="{ on: label.now }">{{ label.now || label.next || '—' }}</b>
      <small v-if="!label.now && label.next">in {{ label.inS.toFixed(1) }}s</small>
      <small v-else-if="label.now && label.next">then {{ label.next }}</small>
    </div>
    <canvas ref="canvas" />
    <div v-if="!notes.length" class="none">No pitches in this chart</div>
  </div>
</template>

<style scoped>
.pg { position: relative; display: flex; align-items: stretch; gap: 10px; height: 92px; flex: none; }
.names { flex: none; width: 74px; display: flex; flex-direction: column; justify-content: center; align-items: center; border-radius: 12px; background: var(--bg); border: 1px solid var(--line); }
.names b { font-size: 24px; font-weight: 800; color: var(--muted); font-variant-numeric: tabular-nums; }
.names b.on { color: var(--accent); }
.names small { font-size: 11px; color: var(--muted); }
canvas { flex: 1; min-width: 0; height: 100%; border-radius: 12px; background: var(--bg); border: 1px solid var(--line); }
.none { position: absolute; inset: 0 0 0 84px; display: grid; place-items: center; color: var(--muted); font-size: 13px; pointer-events: none; }
</style>
