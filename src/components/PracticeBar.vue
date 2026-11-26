<script setup>
// The practice transport (only on the page playing the audio, see lib/practice.js): play/pause, seek, jump to and
// loop a section, slow down, mute stems (e.g. your own part), stop. Space plays/pauses, ← → skip 5 s.
import { computed, onMounted, onBeforeUnmount } from 'vue';
import { practice, toggle, seek, setSpeed, toggleStem, loopSection, stopPractice } from '../lib/practice.js';
import { yarg, fmtTime, sectionIndexAt } from '../lib/yarg.js';

const sections = computed(() => yarg.lyrics?.sections || []);
const secIdx = computed(() => sectionIndexAt(practice.t));
const loopIdx = computed(() => (practice.loop ? sections.value.findIndex((s) => s.t === practice.loop.s) : -1));
function onLoop() { loopSection(practice.loop ? null : Math.max(0, secIdx.value)); }
function onSection(v) {
  const i = Number(v);
  if (practice.loop) loopSection(i);
  else seek(sections.value[i].t);
}
const SPEEDS = [0.5, 0.75, 1];

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); document.activeElement?.blur?.(); toggle(); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); seek(practice.t - 5); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); seek(practice.t + 5); }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="pbar">
    <div class="row">
      <button class="play" :disabled="practice.loading" :aria-label="practice.playing ? 'Pause' : 'Play'" title="Play / pause (Space)" @click="toggle">
        <svg v-if="practice.playing" viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zm6.5 0H17v14h-3.5z" /></svg>
        <svg v-else viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
      </button>
      <span class="tm">{{ practice.loading ? 'Loading…' : fmtTime(practice.t) }}</span>
      <div class="seek">
        <input type="range" min="0" :max="practice.length || 1" step="0.1" :value="practice.t" :disabled="practice.loading" aria-label="Position" @input="seek(Number($event.target.value))" />
        <i v-if="practice.loop && practice.length" class="loopspan"
          :style="{ left: `${(practice.loop.s / practice.length) * 100}%`, width: `${((practice.loop.e - practice.loop.s) / practice.length) * 100}%` }" />
      </div>
      <span class="tm">{{ fmtTime(practice.length) }}</span>
      <button class="x" title="Stop practising" aria-label="Stop practising" @click="stopPractice">✕</button>
    </div>
    <div class="row wrap">
      <label v-if="sections.length" class="sec">
        Section
        <select :value="practice.loop ? loopIdx : Math.max(0, secIdx)" @change="onSection($event.target.value)">
          <option v-for="(s, i) in sections" :key="i" :value="i">{{ s.name }} · {{ fmtTime(s.t) }}</option>
        </select>
      </label>
      <button v-if="sections.length" class="chip" :class="{ on: practice.loop }" :title="practice.loop ? 'Stop looping' : 'Play this section over and over'" @click="onLoop">
        ⟲ {{ practice.loop ? `Looping ${practice.loop.name}` : 'Loop section' }}
      </button>
      <span class="speed" title="Playback speed (the pitch stays the same)">
        Speed
        <button v-for="s in SPEEDS" :key="s" :class="{ on: practice.speed === s }" @click="setSpeed(s)">{{ Math.round(s * 100) }}%</button>
        <button aria-label="Slower" @click="setSpeed(practice.speed - 0.05)">−</button>
        <b>{{ Math.round(practice.speed * 100) }}%</b>
        <button aria-label="Faster" @click="setSpeed(practice.speed + 0.05)">+</button>
      </span>
      <span v-if="practice.stems.length > 1" class="stems" title="Mute a part to play it yourself">
        <button v-for="(s, i) in practice.stems" :key="s.name" :class="{ muted: s.muted }" :title="s.muted ? `Unmute ${s.label}` : `Mute ${s.label}`" @click="toggleStem(i)">{{ s.label }}</button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.pbar { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 10px 14px; border-radius: 16px; background: var(--panel); border: 1px solid #3d2f55; }
.row { display: flex; align-items: center; gap: 10px; }
.row.wrap { flex-wrap: wrap; gap: 8px 14px; }
.play { flex: none; width: 44px; height: 44px; border-radius: 50%; border: 0; background: #b48cff; color: #14101c; display: grid; place-items: center; }
.play svg { width: 22px; height: 22px; fill: currentColor; }
.tm { flex: none; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; min-width: 38px; text-align: center; }
.seek { flex: 1; position: relative; display: flex; align-items: center; }
.seek input { width: 100%; accent-color: #b48cff; position: relative; z-index: 1; }
.loopspan { position: absolute; top: 50%; height: 12px; transform: translateY(-50%); background: #b48cff33; border: 1px solid #b48cff88; border-radius: 4px; pointer-events: none; }
.x { flex: none; width: 34px; height: 34px; border-radius: 10px; background: var(--btn); border: 1px solid var(--line); color: var(--muted); font-weight: 800; }
.sec { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
.sec select { height: 34px; border-radius: 8px; background: var(--btn); border: 1px solid var(--line); color: var(--text); font: inherit; font-weight: 700; padding: 0 6px; max-width: 240px; }
.chip { height: 34px; padding: 0 12px; border-radius: 10px; background: var(--btn); border: 1px solid var(--line); color: var(--muted); font-weight: 700; font-size: 13px; }
.chip.on { color: var(--accent); border-color: var(--accent); }
.speed { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--muted); }
.speed b { min-width: 40px; text-align: center; color: var(--text); font-variant-numeric: tabular-nums; }
.speed button, .stems button { height: 30px; min-width: 30px; padding: 0 8px; border-radius: 8px; background: var(--btn); border: 1px solid var(--line); color: var(--text); font-weight: 700; font-size: 12px; }
.speed button.on { color: var(--accent); border-color: var(--accent); }
.stems { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.stems button.muted { color: var(--muted); text-decoration: line-through; opacity: .6; }
</style>
