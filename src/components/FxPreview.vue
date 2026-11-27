<script setup>
// A little keyboard in Settings playing random notes, to try the Keys view's effects (lib/keysfx.js) as you pick them.
// which: 'land' (notes reaching the keys) or 'hit' (you playing the right note: the key's pressed, outlined white).
import { ref, onActivated, onDeactivated, onMounted, onBeforeUnmount } from 'vue';
import { settings } from '../lib/settings.js';
import { createFx } from '../lib/keysfx.js';

const props = defineProps({ which: { type: String, default: 'land' } });
const BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const HAND = ['#7ff0e4', '#d4bcff'], FILL = ['#3dd6c6', '#b48cff'];
const LO = 48, HI = 72;
const canvas = ref(null);
const fx = createFx();
let raf = 0, last = 0, nextAt = 0;
const down = new Map(); // pitch -> until (s)

function frame(ms) {
  raf = requestAnimationFrame(frame);
  const cv = canvas.value;
  if (!cv || !cv.clientWidth) return;
  const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const t = ms / 1000, dt = Math.min(0.1, Math.max(0, t - last || 0));
  last = t;
  const whites = [];
  for (let p = LO; p <= HI; p++) if (!BLACK[p % 12]) whites.push(p);
  const ww = W / whites.length, bw = ww * 0.62, kbH = Math.min(46, H * 0.4), strikeY = H - kbH;
  const wi = new Map(whites.map((p, i) => [p, i]));
  const keyX = (p) => (BLACK[p % 12] ? (wi.get(p - 1) + 1) * ww - bw / 2 : wi.get(p) * ww);
  const keyW = (p) => (BLACK[p % 12] ? bw : ww);
  const kind = props.which === 'hit' ? settings.keysHitFx : settings.keysFx;
  const amt = props.which === 'hit' ? settings.keysHitFxAmt : settings.keysFxAmt;
  const opt = (p) => ({ x: keyX(p), w: keyW(p), y: strikeY, col: HAND[p < 60 ? 1 : 0], pitch: p, palette: settings.keysFxColor, amt });

  // a new note now and then, sometimes a two-note chord
  if (t >= nextAt) {
    nextAt = t + 0.45 + Math.random() * 0.35;
    const n = Math.random() < 0.3 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const p = LO + Math.floor(Math.random() * (HI - LO + 1));
      down.set(p, t + 0.3 + Math.random() * 0.4);
      fx.burst(kind, opt(p));
    }
  }
  for (const [p, until] of down) { if (t > until) down.delete(p); else fx.sustain(kind, opt(p), dt); }

  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, strikeY);
  bg.addColorStop(0, '#0b0d10'); bg.addColorStop(1, '#141922');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, strikeY);
  fx.draw(ctx, dt, strikeY);
  ctx.fillStyle = '#07080a'; ctx.fillRect(0, strikeY, W, kbH);
  for (const p of whites) {
    const on = down.has(p), h = p < 60 ? 1 : 0;
    ctx.fillStyle = on ? HAND[h] : '#eeeeea';
    ctx.fillRect(keyX(p) + 0.5, strikeY + 2 + (on ? 1.5 : 0), ww - 1, kbH - 3);
    if (on && props.which === 'hit') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(keyX(p) + 1.5, strikeY + 3.5, ww - 3, kbH - 5); }
  }
  for (let p = LO; p <= HI; p++) {
    if (!BLACK[p % 12]) continue;
    const on = down.has(p), h = p < 60 ? 1 : 0;
    ctx.fillStyle = on ? FILL[h] : '#1a1d22';
    ctx.fillRect(keyX(p), strikeY + 1, bw, kbH * 0.62);
  }
  ctx.fillStyle = '#3dd6c6'; ctx.fillRect(0, strikeY - 1, W, 2);
}
const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); };
const halt = () => cancelAnimationFrame(raf);
onMounted(run); onActivated(run);
onDeactivated(halt); onBeforeUnmount(halt);
</script>

<template><canvas ref="canvas" class="fxp" /></template>

<style scoped>
.fxp { display: block; width: 100%; height: 130px; border-radius: 12px; border: 1px solid var(--line); background: #0b0d10; }
</style>
