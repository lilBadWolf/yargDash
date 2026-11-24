<script setup>
// Teleprompter for YARG lyrics: every line of the song, the current one big and centred, syllables lighting up
// as they're sung, and a countdown bar before each entry after a long gap. Follows the song when YARG's data
// stream is on; otherwise it's a plain scrollable lyric sheet.
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { yarg, songTime, synced, phraseText } from '../lib/yarg.js';
import { settings } from '../lib/settings.js';

const props = defineProps({ big: { type: Boolean, default: false }, part: { type: String, default: 'vocals' } });

const phrases = computed(() => yarg.lyrics?.parts?.[props.part]?.phrases || []);
// section headings, shown above the first line sung in that section
const items = computed(() => {
  const secs = yarg.lyrics?.sections || [];
  let si = 0, prevS = -Infinity;
  return phrases.value.map((p, i) => {
    let sec = null;
    // a section marker just after a line's first word (pickup) still labels that line
    const slack = Math.min(1.5, (p.e - p.s) / 2);
    while (si < secs.length && secs[si].t <= p.s + slack) { if (secs[si].t > prevS + 0.05) sec = secs[si].name; si++; }
    prevS = p.s;
    return { i, p, sec, text: phraseText(p) };
  });
});

const cur = ref(-1);      // index of the line being sung, or the next one
const singing = ref(false);
const sung = ref(0);      // syllables of the current line already reached
const scroller = ref(null);
let cdEl = null; // countdown bar (function ref: it lives inside v-for)
const setCd = (el) => { cdEl = el; };
let raf = 0, userScrollUntil = 0;

function tick() {
  raf = requestAnimationFrame(tick);
  const t = songTime(), ps = phrases.value;
  if (t === null || !ps.length) { if (cur.value !== -1) cur.value = -1; return; }
  // last line that has started
  let lo = 0, hi = ps.length - 1, idx = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ps[m].s <= t) { idx = m; lo = m + 1; } else hi = m - 1; }
  const isSinging = idx >= 0 && t <= ps[idx].e + 0.25;
  const c = isSinging ? idx : Math.min(idx + 1, ps.length - 1);
  const n = isSinging ? ps[c].syl.filter((y) => y.t <= t).length : 0;
  if (c !== cur.value) cur.value = c;
  if (isSinging !== singing.value) singing.value = isSinging;
  if (n !== sung.value) sung.value = n;
  // countdown to the next entry after a gap of 3 s or more
  if (cdEl) {
    const prevEnd = idx >= 0 ? ps[idx].e : 0, start = ps[c].s, gap = start - prevEnd;
    const show = !isSinging && gap >= 3 && t < start;
    const frac = show ? Math.min(1, Math.max(0, (start - t) / Math.min(gap, 8))) : 0;
    cdEl.style.transform = `scaleX(${frac})`;
    cdEl.style.opacity = show && start - t <= 8 ? 1 : 0;
  }
}

function center(smooth = true) {
  const el = scroller.value?.querySelector('.line.cur');
  if (!el || performance.now() < userScrollUntil) return;
  const box = scroller.value;
  // current line near the top (right under the pitch guide), with the previous line still in view above it
  let prev = el.previousElementSibling;
  while (prev && !prev.classList.contains('line')) prev = prev.previousElementSibling;
  const above = prev ? el.offsetTop - prev.offsetTop : 0;
  const top = el.offsetTop - Math.min(above + 6, box.clientHeight * 0.3);
  box.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
}
watch(cur, () => nextTick(() => center()));
watch(() => [yarg.lyrics, props.part], () => { cur.value = -1; userScrollUntil = 0; nextTick(() => scroller.value?.scrollTo({ top: 0 })); });
// the user scrolled by hand: stop following for a few seconds
const pauseFollow = () => { userScrollUntil = performance.now() + 4000; };

onMounted(() => { raf = requestAnimationFrame(tick); nextTick(() => center(false)); });
onBeforeUnmount(() => cancelAnimationFrame(raf));

const following = computed(() => synced() && cur.value >= 0);
</script>

<template>
  <div class="lyrics" :class="{ big, following }" :style="{ '--scale': settings.lyricsScale }">
    <div v-if="yarg.lyrics?.error" class="msg">No lyrics for this song <small>({{ yarg.lyrics.error }})</small></div>
    <div v-else-if="yarg.lyrics && !phrases.length" class="msg">This song has no vocals.</div>
    <div v-else ref="scroller" class="scroll" @wheel.passive="pauseFollow" @touchmove.passive="pauseFollow">
      <div class="pad top" />
      <template v-for="it in items" :key="it.i">
        <div v-if="it.sec" class="sec">{{ it.sec }}</div>
        <div class="line" :class="{ cur: it.i === cur, live: it.i === cur && singing, past: following && it.i < cur, next: following && it.i === cur + 1 }">
          <template v-if="it.i === cur && following">
            <div v-if="!singing" class="cd"><i :ref="setCd" /></div>
            <span v-for="(y, k) in it.p.syl" :key="k" :class="{ sung: k < sung }">{{ y.x }}{{ y.j || k === it.p.syl.length - 1 ? '' : ' ' }}</span>
          </template>
          <template v-else>{{ it.text }}</template>
        </div>
      </template>
      <div class="pad" />
    </div>
  </div>
</template>

<style scoped>
.lyrics { --fs: calc(22px * var(--scale, 1)); height: 100%; min-height: 0; display: flex; flex-direction: column; }
.lyrics.big { --fs: calc(30px * var(--scale, 1)); }
.scroll { position: relative; flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 6px; scroll-behavior: auto;
  -webkit-mask-image: linear-gradient(transparent, #000 4%, #000 85%, transparent); mask-image: linear-gradient(transparent, #000 4%, #000 85%, transparent); }
.lyrics:not(.following) .scroll { -webkit-mask-image: none; mask-image: none; }
.pad { height: 70%; }   /* lets the last lines scroll up to the top */
.pad.top { height: 12px; }
.lyrics:not(.following) .pad { height: 8px; }
.sec { margin: calc(var(--fs) * .9) 0 calc(var(--fs) * .2); font-size: max(11px, calc(var(--fs) * .45)); font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); opacity: .8; }
.line { position: relative; font-size: var(--fs); line-height: 1.25; font-weight: 700; padding: calc(var(--fs) * .22) 0; color: var(--text);
  transition: color .25s, opacity .25s; overflow-wrap: break-word; }
.following .line { color: #8a94a3; opacity: .55; }
.following .line.past { opacity: .28; }
.following .line.next { opacity: .8; }
.following .line.cur { opacity: 1; color: #c9d1db; font-size: calc(var(--fs) * 1.12); font-weight: 800; }
.following .line.cur .sung { color: var(--accent); text-shadow: 0 0 18px #3dd6c655; }
.line span { transition: color .08s; }
.cd { position: absolute; left: 0; right: 0; top: -2px; height: 4px; border-radius: 2px; background: #ffffff12; overflow: hidden; }
.cd i { display: block; height: 100%; background: var(--solo); transform-origin: left center; opacity: 0; transition: opacity .2s; }
.msg { margin: auto; color: var(--muted); font-size: 16px; text-align: center; padding: 20px; }
.msg small { display: block; font-size: 12px; margin-top: 4px; }
</style>
