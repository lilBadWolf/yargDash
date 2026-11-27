// A light-up keyboard's key lights (lib/midi.js), following the song's keyboard part whatever view is showing: the
// part the Keys view shows (or would), lit settings.lightsLead s before each note and while it sounds; struck again,
// a key blinks.
// Started once by App.vue. Runs on a timer of its own, so it keeps time with the window in the background too.
import { computed, watch } from 'vue';
import { yarg, songTime, fetchTabTrack, keysTrackId } from './yarg.js';
import { settings } from './settings.js';
import { route } from './router.js';
import { midi, start as midiStart, stop as midiStop, setLights, allOff, refresh } from './midi.js';

const COLOUR = [2, 1]; // right hand blue, left hand red (one-colour keyboards, like the ONE Piano COLOR, show both red)

// Use the MIDI keyboard on this device (null setting: only on the YARG computer)
export const useMidi = computed(() => settings.keysMidi ?? yarg.local);

let track = null, owner = new Map(); // note -> index of the chart note that lit it
const lowerBound = (a, t) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m][0] < t) lo = m + 1; else hi = m; } return lo; };
const hand = (n) => (n[3] >= 0 ? n[3] : n[2] < 60 ? 1 : 0);

// all off: when the song stops or changes, sweep every key (whatever was lit, even by an earlier page)
let swept = false; // (false at first: clear whatever an earlier session left lit)
function off() {
  if (!swept) { allOff(true); swept = true; }
  owner = new Map();
}

function tick() {
  if (!useMidi.value || !settings.keysLights || !midi.lights) return;
  const t = songTime();
  if (!track || t == null || !isFinite(t) || yarg.clock?.state === 'off') { off(); return; }
  const notes = track.notes, want = new Map(), next = new Map(), restrike = [];
  const lead = Math.min(1, Math.max(0, Number(settings.lightsLead) || 0));
  for (let i = lowerBound(notes, t - (track.maxDur || 0) - 0.2); i < notes.length && notes[i][0] <= t + lead; i++) {
    const n = notes[i], [nt, dur, p] = n;
    if (t >= nt + Math.max(dur, 0.15) - 0.03) continue; // done (and a gap before the same key's next note)
    if (next.has(p) && notes[next.get(p)][0] >= nt) continue;
    next.set(p, i);
    want.set(p, COLOUR[hand(n)]);
  }
  for (const [p, i] of next) if (owner.has(p) && owner.get(p) !== i) restrike.push(p);
  owner = next;
  if (want.size) swept = false;
  setLights(want, restrike);
}

export function startKeysLights() {
  let on = false;
  watch(useMidi, (v) => {
    if (v && !on) { on = true; midiStart(); }
    else if (!v && on) { on = false; midiStop(); }
  }, { immediate: true });
  watch(() => settings.keysLights, (v) => { if (!v) off(); });
  // which keyboard / which output and how (Settings → Keys & MIDI)
  watch(() => [settings.midiInput, settings.lightsOut, settings.lightsProto, settings.lightsChannel], () => { owner = new Map(); refresh(); });
  // the keyboard part: the one picked for the Keys view
  let seq = 0;
  watch(() => [yarg.song?.name, yarg.tabs?.version, keysTrackId(route.tabTrack)], async ([, , id]) => {
    const mine = ++seq;
    const t = id ? await fetchTabTrack(id).catch(() => null) : null;
    if (mine !== seq) return;
    if (t && t.maxDur == null) t.maxDur = Math.min(30, Math.max(0, ...t.notes.map((n) => n[1])));
    track = t;
    off();
  }, { immediate: true });
  setInterval(tick, 20);
}
