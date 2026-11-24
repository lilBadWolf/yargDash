<script setup>
// Click for the drummer: the beat count in the bar, flashing on every beat (bar 1 accented), the bar number and
// how many bars until the next section. Timed from the chart's beat grid and the song clock, so it's on the beat
// rather than a network hop behind it. Optional audible click on this device (Web Audio, scheduled ahead).
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { yarg, songTime, playRate, sectionIndexAt } from '../lib/yarg.js';
import { settings } from '../lib/settings.js';

const beats = computed(() => yarg.lyrics?.beats || []);
const st = ref({ i: -1, count: 0, perBar: 4, bar: 0, nextSec: null, barsToNext: 0 });
let raf = 0, cursor = 0;

// index of the last beat at or before t
function beatIndex(t) {
  const b = beats.value;
  if (cursor >= b.length || (cursor > 0 && b[cursor - 1][0] > t)) cursor = 0;
  while (cursor < b.length && b[cursor][0] <= t) cursor++;
  return cursor - 1;
}

function frame() {
  raf = requestAnimationFrame(frame);
  const t = songTime();
  const b = beats.value;
  if (t == null || !isFinite(t) || !b.length) { if (st.value.i !== -1) st.value = { ...st.value, i: -1, count: 0 }; return; }
  const i = beatIndex(t);
  if (i === st.value.i) return;
  if (i < 0) { st.value = { ...st.value, i, count: 0 }; return; }
  let barStart = i; while (barStart > 0 && b[barStart][1] !== 0) barStart--;
  let barEnd = i + 1; while (barEnd < b.length && b[barEnd][1] !== 0) barEnd++;
  let bar = 0; for (let j = 0; j <= i; j++) if (b[j][1] === 0) bar++;
  const secs = yarg.lyrics?.sections || [];
  const next = secs[sectionIndexAt(t) + 1] || null;
  let barsToNext = 0;
  if (next) for (let j = i + 1; j < b.length && b[j][0] < next.t - 0.05; j++) if (b[j][1] === 0) barsToNext++;
  st.value = { i, count: i - barStart + 1, perBar: Math.max(1, barEnd - barStart), bar, nextSec: next?.name || null, barsToNext };
}

// ---------- audible click ----------
let ac = null, timer = 0, nextIdx = -1, lastT = null;
function schedule() {
  const t = songTime(false), b = beats.value;
  if (!ac || t == null || !isFinite(t) || yarg.clock.state !== 'run' || !b.length) { nextIdx = -1; return; }
  if (lastT !== null && t < lastT - 0.05) nextIdx = -1; // jumped back (restart)
  lastT = t;
  if (nextIdx < 0) { nextIdx = 0; while (nextIdx < b.length && b[nextIdx][0] < t) nextIdx++; }
  const lat = (ac.outputLatency || 0) + (ac.baseLatency || 0);
  const ahead = 0.2, rate = playRate() || 1;
  while (nextIdx < b.length && b[nextIdx][0] < t + ahead * rate) {
    const [bt, k] = b[nextIdx++];
    const when = ac.currentTime + (bt - t) / rate - lat + (settings.lyricsOffsetMs || 0) / 1000;
    if (when < ac.currentTime) continue;
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.frequency.value = k === 0 ? 1760 : 1175;
    g.gain.setValueAtTime(k === 0 ? 0.9 : 0.5, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    osc.connect(g).connect(ac.destination);
    osc.start(when); osc.stop(when + 0.06);
  }
}
function setSound(on) {
  settings.clickSound = on;
  if (on) {
    ac ??= new (window.AudioContext || window.webkitAudioContext)();
    ac.resume(); // must start from a tap (browser autoplay rules)
    nextIdx = -1;
    timer ||= setInterval(schedule, 25);
  } else {
    clearInterval(timer); timer = 0;
  }
}
watch(() => yarg.clock.play, () => { nextIdx = -1; });

onMounted(() => { raf = requestAnimationFrame(frame); if (settings.clickSound) settings.clickSound = false; /* needs a tap each visit */ });
onBeforeUnmount(() => { cancelAnimationFrame(raf); clearInterval(timer); ac?.close(); });

const running = computed(() => yarg.clock.state === 'run');
</script>

<template>
  <div class="click" :class="{ idle: st.i < 0 || !running }">
    <div :key="st.i" class="beat" :class="{ one: st.count === 1, flash: running && st.i >= 0 }">{{ st.count || '–' }}</div>
    <div class="dots"><i v-for="n in Math.min(st.perBar, 16)" :key="n" :class="{ on: n === st.count, one: n === 1 }" /></div>
    <div class="info">
      <span>Bar <b>{{ st.bar || '–' }}</b></span>
      <span v-if="yarg.clock.bpm"><b>{{ yarg.clock.bpm }}</b> BPM</span>
      <span v-if="st.nextSec">{{ st.nextSec }} in <b>{{ st.barsToNext + 1 }}</b> {{ st.barsToNext === 0 ? 'bar' : 'bars' }}</span>
    </div>
    <button class="snd" :class="{ on: settings.clickSound }" @click="setSound(!settings.clickSound)">
      <svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z" /><path v-if="settings.clickSound" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" /></svg>
      {{ settings.clickSound ? 'Click sound on' : 'Click sound' }}
    </button>
  </div>
</template>

<style scoped>
.click { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 16px; }
.beat { font-size: min(42vh, 60vw); line-height: .9; font-weight: 900; font-variant-numeric: tabular-nums; color: #c9d1db; }
.beat.one { color: var(--solo); }
.beat.flash { animation: hit .22s ease-out; }
@keyframes hit { from { transform: scale(1.12); text-shadow: 0 0 40px currentColor; } }
.idle .beat { color: var(--muted); opacity: .4; }
.dots { display: flex; gap: 10px; }
.dots i { width: 18px; height: 18px; border-radius: 50%; background: #ffffff14; transition: background .06s; }
.dots i.on { background: #c9d1db; }
.dots i.on.one { background: var(--solo); box-shadow: 0 0 14px var(--solo); }
.info { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 22px; font-size: 18px; color: var(--muted); }
.info b { color: var(--text); font-variant-numeric: tabular-nums; }
.snd { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border-radius: 12px; background: var(--btn); border: 1px solid var(--line); color: var(--muted); font-weight: 700; }
.snd.on { color: var(--accent); border-color: var(--accent); }
.snd svg { width: 18px; height: 18px; fill: currentColor; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
</style>
