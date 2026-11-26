// Practice: play a library song's audio on this computer while YARG isn't running, and have every device follow it
// (the server makes it the song shown; this page's audio drives the clock, see server/yarg.mjs practiceClock).
//
// One <audio> per stem (song.ogg, guitar.ogg, …) so each can be muted, and so slowing down keeps the pitch.
// The longest stem is the master; the others are kept in step with it by nudging their speed (or a jump when far off).
// Lives at module level so it keeps playing while you move between the Dashboard and the Library.
import { reactive, watch } from 'vue';
import { post } from './conn.js';
import { yarg } from './yarg.js';

export const practice = reactive({
  id: null,         // the library song this page is playing (null: not practising here)
  loading: false,
  error: '',
  playing: false,
  t: 0,             // song time (s)
  length: 0,        // audio length (s)
  speed: 1,         // 0.5–1.25
  stems: [],        // [{ name, label, muted }]
  loop: null,       // { s, e, name }: play this stretch over and over
});

const LABEL = { song: 'Band', guitar: 'Guitar', rhythm: 'Rhythm', bass: 'Bass', drums: 'Drums', keys: 'Keys', vocals: 'Vocals', backing: 'Backing' };
const stemLabel = (file) => {
  const [, k, n] = file.toLowerCase().replace(/\.[^.]+$/, '').match(/^([a-z]+)(?:_(\d+))?/) || [, file];
  return `${LABEL[k] || k}${n ? ` ${n}` : ''}`;
};

let els = [], master = null, delay = 0, timer = 0, lastReport = 0;
const audioT = () => (master ? master.currentTime : 0);

function report() {
  if (!practice.id || !master) return;
  lastReport = performance.now();
  post('/practice/clock', { state: practice.playing ? 'run' : 'pause', t: audioT() - delay, rate: practice.speed });
}

function tick() {
  if (!master) return;
  const a = audioT();
  practice.t = a - delay;
  if (practice.playing && practice.loop && practice.t >= practice.loop.e) { seek(practice.loop.s); return; }
  if (practice.playing && master.ended) { practice.playing = false; for (const el of els) el.pause(); report(); return; }
  if (!practice.playing) return;
  for (const el of els) {
    if (el === master) continue;
    if (a >= (el.duration || 0)) continue; // a shorter stem that's done
    if (el.paused) { el.currentTime = a; el.play().catch(() => {}); continue; }
    const drift = el.currentTime - a;
    if (Math.abs(drift) > 0.25) el.currentTime = a;
    else el.playbackRate = practice.speed * (Math.abs(drift) > 0.008 ? 1 - Math.max(-0.05, Math.min(0.05, drift * 2)) : 1);
  }
  if (performance.now() - lastReport > 1000) report();
}

function teardown() {
  clearInterval(timer); timer = 0;
  for (const el of els) { el.pause(); el.removeAttribute('src'); el.load(); }
  els = []; master = null;
  Object.assign(practice, { id: null, loading: false, playing: false, t: 0, length: 0, stems: [], loop: null });
}

export async function startPractice(id) {
  if (practice.id) await stopPractice();
  practice.loading = true; practice.error = '';
  try {
    const r = await fetch('/practice/start', { method: 'POST', body: JSON.stringify({ id }), headers: { 'Content-Type': 'text/plain' } });
    const j = await r.json().catch(() => ({ error: `failed (${r.status})` }));
    if (!r.ok) throw new Error(j.error || 'failed');
    delay = j.delay || 0;
    practice.id = id;
    practice.stems = j.stems.map((s) => ({ name: s.name, label: stemLabel(s.name), muted: false }));
    els = j.stems.map((s) => {
      const el = new Audio();
      el.preload = 'auto';
      el.preservesPitch = true;
      el.src = `/library/stem?id=${encodeURIComponent(id)}&name=${encodeURIComponent(s.name)}`;
      return el;
    });
    await Promise.all(els.map((el, i) => new Promise((res, rej) => {
      if (el.readyState >= 3) return res();
      el.addEventListener('canplay', res, { once: true });
      el.addEventListener('error', () => rej(new Error(`Couldn't play ${j.stems[i].name}`)), { once: true });
    })));
    if (practice.id !== id) return; // stopped while loading
    master = els.reduce((a, b) => ((b.duration || 0) > (a.duration || 0) ? b : a));
    for (const ev of ['playing', 'pause', 'seeked']) master.addEventListener(ev, report);
    practice.length = master.duration || 0;
    for (const el of els) el.playbackRate = practice.speed;
    seekAll(Math.max(0, delay));
    timer = setInterval(tick, 40);
    report();
  } catch (e) {
    practice.error = e.message;
    post('/practice/stop', {});
    teardown();
  } finally { practice.loading = false; }
}

export async function stopPractice() {
  if (!practice.id) return;
  teardown();
  await post('/practice/stop', {});
}

function seekAll(a) {
  for (const el of els) el.currentTime = Math.min(a, Math.max(0, (el.duration || a) - 0.01));
}
// t: song time (s)
export function seek(t) {
  if (!master) return;
  const a = Math.max(0, Math.min(practice.length - 0.05, t + delay));
  seekAll(a);
  practice.t = a - delay;
  if (practice.playing) for (const el of els) if (a < (el.duration || 0)) el.play().catch(() => {});
  report();
}
export function play() {
  if (!master || practice.playing) return;
  if (master.ended || audioT() >= practice.length - 0.05) seek(practice.loop?.s ?? 0);
  practice.playing = true;
  const a = audioT();
  for (const el of els) if (a < (el.duration || 0)) { el.playbackRate = practice.speed; el.play().catch(() => {}); }
}
export function pause() {
  if (!master) return;
  practice.playing = false;
  for (const el of els) el.pause();
  seekAll(audioT()); // line them back up while stopped
  report();
}
export const toggle = () => (practice.playing ? pause() : play());
export function setSpeed(x) {
  practice.speed = Math.round(Math.min(1.25, Math.max(0.5, x)) * 100) / 100;
  for (const el of els) el.playbackRate = practice.speed;
  report();
}
export function toggleStem(i) {
  const s = practice.stems[i];
  if (!s) return;
  s.muted = !s.muted;
  if (els[i]) els[i].muted = s.muted;
}
// Loop one section of the chart (or stop looping: null)
export function loopSection(i) {
  const secs = yarg.lyrics?.sections || [];
  if (i == null || !secs[i]) { practice.loop = null; return; }
  const e = secs[i + 1]?.t ?? practice.length - delay;
  practice.loop = { s: secs[i].t, e, name: secs[i].name };
  if (practice.t < practice.loop.s || practice.t >= e) seek(secs[i].t);
}

// The server ended practice (YARG started, or another page stopped it): stop here too
watch(() => yarg.song, (s) => { if (practice.id && !practice.loading && !(s?.practice && s.id === practice.id)) teardown(); });
// Leaving the page: the music stops, so let the other devices know
window.addEventListener('pagehide', () => { if (practice.id) navigator.sendBeacon('/practice/stop', '{}'); });
