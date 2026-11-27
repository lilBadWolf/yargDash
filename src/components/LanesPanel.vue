<script setup>
// Note highways for every part of the song YARG is playing (guitar, rhythm, bass, drums, keys at Expert), side by
// side, whether or not anyone is playing them: an audience screen / preview. Notes come toward the strike line in
// perspective, in time with the song (the same clock as the lyrics). Under them, the line being sung.
// Drawn on a canvas each frame; only the notes inside the visible window are touched.
import { ref, computed, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue';
import { yarg, songTime, shownSong, fetchLanes, LANE, phraseText } from '../lib/yarg.js';
import { settings } from '../lib/settings.js';

const ORDER = ['guitar', 'rhythm', 'bass', 'drums', 'keys'];
const FRET = ['#3ec34b', '#e5413b', '#f2d02c', '#3a8df0', '#f39a2a'];         // green red yellow blue orange
const PADS4 = ['#e5413b', '#f2d02c', '#3a8df0', '#3ec34b'];                    // red yellow blue green
const PADS5 = ['#e5413b', '#f2d02c', '#3a8df0', '#f39a2a', '#3ec34b'];         // red yellow blue orange green
const OPEN = '#b45cf0', KICK = '#f08a24', STAR = '#8ff0ff';

// ---------- data ----------
const data = ref(null);
const error = ref('');
const songKey = computed(() => { const s = shownSong(); return s ? `${s.artist}|${s.name}` : ''; });
let tries = 0, retry = 0;
async function load() {
  clearTimeout(retry);
  if (!songKey.value) { data.value = null; return; }
  try {
    const d = await fetchLanes();
    const k = d.song ? `${d.song.artist}|${d.song.name}` : '';
    if (k !== songKey.value) { if (++tries < 6) retry = setTimeout(load, 500); return; } // server not there yet
    tries = 0;
    for (const p of Object.values(d.lanes)) p.maxDur = Math.min(30, Math.max(0, ...p.notes.map((n) => n[1])));
    data.value = d;
    error.value = '';
  } catch (e) { if (e.old) { error.value = e.message; return; } if (++tries < 6) retry = setTimeout(load, 2000); }
}
watch(songKey, () => { tries = 0; data.value = null; load(); }, { immediate: true });

const available = computed(() => ORDER.filter((k) => data.value?.lanes?.[k]));
const shown = computed(() => available.value.filter((k) => !settings.lanesHidden.includes(k)));
defineExpose({ available });

// ---------- lyric line ----------
const phrases = computed(() => yarg.lyrics?.parts?.vocals?.phrases || []);
const lyric = ref({ cur: null, sung: 0, next: '' });
function updateLyric(t) {
  const ps = phrases.value;
  if (t == null || !ps.length) { if (lyric.value.cur) lyric.value = { cur: null, sung: 0, next: '' }; return; }
  let lo = 0, hi = ps.length - 1, i = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ps[m].s <= t + 0.3) { i = m; lo = m + 1; } else hi = m - 1; }
  if (i >= 0 && t > ps[i].e + 0.4 && ps[i + 1]) i = ps[i + 1].s - t < 2.5 ? i + 1 : -1; // gap: show the next line shortly before it
  if (i < 0 && ps[0] && ps[0].s - t < 2.5) i = 0;
  const p = i >= 0 ? ps[i] : null;
  const sung = p ? p.syl.filter((y) => y.t <= t).length : 0;
  const next = p && ps[i + 1] ? phraseText(ps[i + 1]) : '';
  if (p !== lyric.value.cur || sung !== lyric.value.sung) lyric.value = { cur: p, sung, next };
}

// ---------- drawing ----------
const canvas = ref(null), box = ref(null);
let raf = 0;
const lowerBound = (notes, t) => { let lo = 0, hi = notes.length; while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m][0] < t) lo = m + 1; else hi = m; } return lo; };
const inSpan = (spans, t) => spans.some(([a, b]) => t >= a && t < b);

function draw() {
  raf = requestAnimationFrame(draw);
  const cv = canvas.value, el = box.value;
  if (!cv || !el) return;
  const W = el.clientWidth, H = el.clientHeight, dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const t = songTime();
  updateLyric(t);
  const parts = shown.value;
  if (!data.value || !parts.length) return;
  const now = t == null || !isFinite(t) ? 0 : t;
  const T = 1.6 / (settings.lanesSpeed || 1);                // seconds from the far end to the strike line
  const n = parts.length, colW = W / n;
  const labelH = 26, y0 = 8, strikeY = H - labelH - 14;
  const bw = Math.min(colW * 0.9, (strikeY - y0) * 1.25);    // highway width at the strike line
  // far end is TOP × as wide: less perspective when columns are tall and thin (phones), so far notes stay readable
  const TOP = Math.min(0.55, Math.max(0.3, 0.6 - (colW / Math.max(1, strikeY - y0)) * 0.5)), K = 1 / TOP - 1, s1 = TOP;
  const beats = yarg.lyrics?.beats || [];

  parts.forEach((key, pi) => {
    const p = data.value.lanes[key];
    const cx = colW * (pi + 0.5);
    const drums = p.kind === 'drums';
    const nl = drums ? p.pads : 5;
    // time → (scale, y); u in [-0.5, 0.5] across the highway
    const at = (dt) => { const z = dt / T, s = 1 / (1 + K * z); return { s, y: y0 + (strikeY - y0) * ((s - s1) / (1 - s1)) }; };
    const X = (u, s) => cx + u * bw * s;
    const laneU = (l) => -0.5 + (l + 0.5) / nl;              // five-fret lane 0-4 / drum pad 1..pads → l-1
    const quad = (dtA, dtB, uA, uB, fill) => {
      const a = at(dtA), b = at(dtB);
      ctx.beginPath(); ctx.moveTo(X(uA, a.s), a.y); ctx.lineTo(X(uB, a.s), a.y); ctx.lineTo(X(uB, b.s), b.y); ctx.lineTo(X(uA, b.s), b.y); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
    };
    const PAST = -0.12;
    // highway + solo sections
    const g = ctx.createLinearGradient(0, y0, 0, strikeY);
    g.addColorStop(0, '#0b0d1000'); g.addColorStop(0.35, '#151a22'); g.addColorStop(1, '#1b212b');
    quad(PAST, T, -0.5, 0.5, g);
    for (const [a, b] of p.solo) if (b > now + PAST && a < now + T) quad(Math.max(PAST, a - now), Math.min(T, b - now), -0.5, 0.5, '#3a8df022');
    // lane dividers
    ctx.strokeStyle = '#ffffff12'; ctx.lineWidth = 1;
    for (let l = 1; l < nl; l++) { const u = -0.5 + l / nl, a = at(0), b = at(T); ctx.beginPath(); ctx.moveTo(X(u, a.s), a.y); ctx.lineTo(X(u, b.s), b.y); ctx.stroke(); }
    // beat lines (bar lines brighter)
    for (let i = lowerBound(beats, now + PAST); i < beats.length && beats[i][0] < now + T; i++) {
      const [bt, k] = beats[i], { s, y } = at(bt - now);
      ctx.fillStyle = k === 0 ? '#ffffff40' : '#ffffff16';
      ctx.fillRect(X(-0.5, s), y - (k === 0 ? 1 : 0.5), bw * s, k === 0 ? 2 : 1);
    }
    // edges, strike line and targets
    ctx.strokeStyle = inSpan(p.star, now) ? STAR : '#ffffff30'; ctx.lineWidth = 2;
    for (const u of [-0.5, 0.5]) { const a = at(PAST), b = at(T); ctx.beginPath(); ctx.moveTo(X(u, a.s), a.y); ctx.lineTo(X(u, b.s), b.y); ctx.stroke(); }
    ctx.fillStyle = '#ffffffb0'; ctx.fillRect(X(-0.5, 1), strikeY - 1.5, bw, 3);
    const laneW = bw / nl;
    for (let l = 0; l < nl; l++) {
      const c = drums ? (p.pads === 5 ? PADS5 : PADS4)[l] : FRET[l];
      ctx.strokeStyle = c; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(X(laneU(l), 1), strikeY, laneW * 0.42, laneW * 0.2, 0, 0, Math.PI * 2); ctx.stroke();
    }

    const notes = p.notes;
    const from = lowerBound(notes, now + PAST - (p.maxDur || 0)), to = lowerBound(notes, now + T);
    // sustains (behind the gems), drawn from the strike line once the note has started
    for (let i = from; i < to; i++) {
      const [nt, dur, lane, fl] = notes[i];
      if (!dur || nt + dur < now) continue;
      const u = lane === 5 ? 0 : laneU(lane), w = lane === 5 ? 0.9 : 0.22 / nl; // open notes: across the highway, fainter
      quad(Math.max(0, nt - now), Math.min(T, nt + dur - now), u - w / 2, u + w / 2, (fl & LANE.STAR ? STAR : lane === 5 ? OPEN : FRET[lane]) + (lane === 5 ? '55' : 'aa'));
    }
    // gems, far to near (kicks first, so pads at the same moment sit on top); a note vanishes into a flash at the strike line
    const order = [];
    for (let i = to - 1; i >= from; i--) if (drums && notes[i][2] === 0) order.push(i);
    for (let i = to - 1; i >= from; i--) if (!(drums && notes[i][2] === 0)) order.push(i);
    for (const i of order) {
      const [nt, , lane, fl] = notes[i], dt = nt - now;
      if (dt < -0.12) continue;
      if (dt < 0) { // flash
        const a = 1 + dt / 0.12, c = drums ? (lane === 0 ? KICK : (p.pads === 5 ? PADS5 : PADS4)[lane - 1]) : lane === 5 ? OPEN : FRET[lane];
        ctx.globalAlpha = a * 0.7; ctx.fillStyle = c;
        if ((drums && lane === 0) || lane === 5) ctx.fillRect(X(-0.5, 1), strikeY - 6, bw, 12);
        else { ctx.beginPath(); ctx.ellipse(X(laneU(drums ? lane - 1 : lane), 1), strikeY, laneW * 0.48, laneW * 0.24, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
        continue;
      }
      const { s, y } = at(dt), lw = laneW * s, star = fl & LANE.STAR;
      if (drums && lane === 0) { // kick: a bar across the highway
        ctx.fillStyle = star ? STAR : KICK; ctx.globalAlpha = fl & LANE.KICK2 ? 0.6 : 1;
        ctx.fillRect(X(-0.47, s), y - lw * 0.05, bw * s * 0.94, lw * 0.1); ctx.globalAlpha = 1;
        continue;
      }
      if (!drums && lane === 5) { // open note
        ctx.fillStyle = star ? STAR : OPEN; ctx.fillRect(X(-0.47, s), y - lw * 0.08, bw * s * 0.94, lw * 0.16);
        if (fl & LANE.HOPO) { ctx.fillStyle = '#ffffffaa'; ctx.fillRect(X(-0.47, s), y - lw * 0.02, bw * s * 0.94, lw * 0.04); }
        continue;
      }
      const l = drums ? lane - 1 : lane, x = X(laneU(l), s);
      const col = star ? STAR : drums ? (p.pads === 5 ? PADS5 : PADS4)[l] : FRET[l];
      const rx = lw * 0.44, ry = lw * 0.22;
      if (drums && fl & LANE.CYMBAL) { // cymbal: a flat disc with a bright edge
        ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx * 1.1, ry * 0.7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = Math.max(1, lw * 0.04); ctx.stroke();
        ctx.fillStyle = '#ffffffcc'; ctx.beginPath(); ctx.ellipse(x, y, rx * 0.16, ry * 0.16, 0, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      if (fl & LANE.TAP) { // tap: dark gem, coloured rim
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, lw * 0.08); ctx.stroke();
        continue;
      }
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffffdd'; ctx.lineWidth = Math.max(1, lw * (fl & LANE.HOPO ? 0.09 : 0.035)); ctx.stroke();
      if (!(fl & LANE.HOPO)) { ctx.fillStyle = '#00000066'; ctx.beginPath(); ctx.ellipse(x, y, rx * 0.4, ry * 0.4, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    // label (+ solo / star power)
    ctx.font = '700 13px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tags = [inSpan(p.solo, now) ? 'SOLO' : '', inSpan(p.star, now) ? '★' : ''].filter(Boolean).join(' ');
    ctx.fillStyle = '#c9d1db'; ctx.fillText(p.name + (tags ? `  ${tags}` : ''), cx, H - labelH / 2 - 2);
  });
}

// drawn only while shown (views and panels stay alive in the background, see App.vue / DashView)
onActivated(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
onDeactivated(() => cancelAnimationFrame(raf));
onBeforeUnmount(() => { cancelAnimationFrame(raf); clearTimeout(retry); });
</script>

<template>
  <div class="lanes">
    <div ref="box" class="road">
      <canvas ref="canvas" />
      <div v-if="error" class="msg">{{ error }}</div>
      <div v-else-if="!data" class="msg">Loading…</div>
      <div v-else-if="!available.length" class="msg">This chart has no guitar, bass, drums or keys parts.</div>
      <div v-else-if="!shown.length" class="msg">All parts are hidden on this device.</div>
    </div>
    <div v-if="phrases.length" class="lyric">
      <div class="cur">
        <template v-if="lyric.cur">
          <span v-for="(y, i) in lyric.cur.syl" :key="i" :class="{ sung: i < lyric.sung }">{{ y.x }}{{ y.j || i === lyric.cur.syl.length - 1 ? '' : ' ' }}</span>
        </template>
        <span v-else class="rest">♪</span>
      </div>
      <div class="next">{{ lyric.next }}</div>
    </div>
  </div>
</template>

<style scoped>
.lanes { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.road { position: relative; flex: 1; min-height: 0; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.msg { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); }
.lyric { flex: none; padding: 8px 12px 10px; text-align: center; border-top: 1px solid var(--line); }
.lyric .cur { font-size: clamp(18px, 3.2vw, 34px); font-weight: 800; color: var(--muted); min-height: 1.3em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lyric .cur .sung { color: var(--accent); }
.lyric .cur .rest { opacity: 0.5; }
.lyric .next { font-size: clamp(13px, 1.8vw, 18px); color: var(--muted); opacity: 0.6; min-height: 1.3em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
