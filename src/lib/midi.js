// A MIDI keyboard plugged into this computer, for the Keys view (Web MIDI; desktop browsers and the app):
//  * the keys you press show on the virtual keyboard (held, read by KeysPanel each frame). Any MIDI keyboard.
//  * a light-up keyboard's keys light as the notes are due (lib/keyslights.js decides which), one of two ways:
//      one    The ONE keyboards (ONE Piano COLOR, ONE Smart Piano, ONE Light Keyboard): Polyphonic Key Pressure on
//             channel 3, `A2 <note − 21> <colour>` (1 red, 2 blue, 0 off); SysEx `F0 00 20 2B 69 16 02 00 F7` turns
//             every light off. (As worked out by github.com/vhorvath2010/open-one-piano.)
//      notes  keyboards that light a key for each note they're sent (Casio's lighted-key models, some Yamaha and
//             others): Note On / Off on a channel. Such a keyboard may also sound them: turn that channel down on it.
//    Lights go only to a The ONE keyboard by itself, or to the output picked in Settings: never to other gear unasked.
import { reactive } from 'vue';
import { settings } from './settings.js';

export const midi = reactive({
  status: typeof navigator !== 'undefined' && navigator.requestMIDIAccess ? 'off' : 'unsupported', // off | asking | ready | denied | unsupported
  allInputs: [],  // every MIDI input's name
  allOutputs: [], // every MIDI output's name
  inputs: [],     // names of the keyboards we listen to
  lights: '',     // name of the output whose keys we light ('' = none)
  proto: '',      // how: one | notes
  error: '',
  last: null,     // the last key pressed: { from, note, vel } (Settings shows it, to check a keyboard works)
  count: 0,       // messages received
});

export const held = new Map(); // MIDI note -> { at: performance.now() when pressed, vel }
let access = null, sysex = false, users = 0;
export const isOneName = (name) => /\bONE\b/.test(name || '');
const isOne = (port) => isOneName(port.name) || /medeli/i.test(port.manufacturer || '');

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const noteName = (n) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
function onMessage(e) {
  const [st, a, b] = e.data;
  if (st >= 0xf8) return; // clock ticks, "still here" pings…: many a second, nothing to do with keys
  const kind = st & 0xf0;
  midi.count++;
  if (kind === 0x90 && b > 0) { held.set(a, { at: performance.now(), vel: b }); midi.last = { from: e.target?.name || '', note: a, vel: b }; }
  else if (kind === 0x80 || (kind === 0x90 && b === 0)) held.delete(a);
  else if (kind === 0xb0 && (a === 123 || a === 120)) held.clear(); // all notes / sound off
}

const live = (m) => (access ? [...access[m].values()].filter((p) => p.state !== 'disconnected') : []);
function lightOut() {
  const outs = live('outputs');
  return settings.lightsOut ? outs.find((o) => o.name === settings.lightsOut) || null : outs.find(isOne) || null;
}
function protoFor(out) {
  if (!out) return '';
  return settings.lightsProto === 'one' || settings.lightsProto === 'notes' ? settings.lightsProto : isOne(out) ? 'one' : 'notes';
}

export function refresh() {
  if (!access) return;
  const ins = live('inputs');
  midi.allInputs = ins.map((i) => i.name);
  midi.allOutputs = live('outputs').map((o) => o.name);
  const use = ins.filter((i) => !settings.midiInput || i.name === settings.midiInput);
  for (const i of ins) i.onmidimessage = use.includes(i) ? onMessage : null;
  midi.inputs = use.map((i) => i.name);
  const out = lightOut(), proto = protoFor(out);
  if ((out?.name || '') !== midi.lights || proto !== midi.proto) { allOff(); lit.clear(); }
  midi.lights = out?.name || '';
  midi.proto = proto;
}

// Start listening (lib/keyslights.js asks while it's wanted; stop() when not)
export async function start() {
  users++;
  if (access || midi.status === 'asking' || midi.status === 'unsupported') { refresh(); return; }
  midi.status = 'asking';
  try {
    try { access = await navigator.requestMIDIAccess({ sysex: true }); sysex = true; }
    catch { access = await navigator.requestMIDIAccess(); sysex = false; }
    access.onstatechange = refresh;
    midi.status = 'ready';
    refresh();
  } catch (e) {
    midi.status = 'denied';
    midi.error = e.message;
  }
}
export function stop() {
  users = Math.max(0, users - 1);
  if (users) return;
  allOff(true);
  held.clear();
  if (access) for (const i of access.inputs.values()) i.onmidimessage = null;
}

// ---------- the keyboard's keys ----------
// Web MIDI doesn't say how many keys a keyboard has: known models by name, else the size picked in Settings (61 by
// default), at the usual place for that size; kbShift moves it by octaves (for its octave buttons).
export const KB_SIZES = { 25: [48, 72], 32: [41, 72], 37: [48, 84], 49: [36, 84], 61: [36, 96], 76: [28, 103], 88: [21, 108] };
const KNOWN = [[/ONE Smart Piano|ONE Piano(?! COLOR)|\bTOP\b/i, 88], [/\bONE\b/, 61]];
export function keyboardSize() {
  if (settings.kbSize !== 'auto' && KB_SIZES[settings.kbSize]) return { keys: Number(settings.kbSize), auto: false };
  const name = midi.inputs.find((n) => KNOWN.some(([re]) => re.test(n))) || '';
  const k = KNOWN.find(([re]) => re.test(name));
  return { keys: k ? k[1] : 61, auto: true, model: k ? name : '' };
}
// [lowest, highest] MIDI note of the keyboard, or null when no keyboard's plugged in
export function keyboardRange() {
  if (!midi.inputs.length) return null;
  const [lo, hi] = KB_SIZES[keyboardSize().keys];
  const sh = 12 * (Number(settings.kbShift) || 0);
  return [Math.max(0, lo + sh), Math.min(127, hi + sh)];
}

// ---------- lights ----------
const lit = new Map(); // note -> colour sent
// Messages go out paced, at most one every PACE ms: a small keyboard's USB MIDI can lock up when it gets a burst
// (until it's turned off and on). Usually there's no wait: lights change a few keys at a time.
const PACE = 1.5;
let nextAt = 0;
function send(msg) {
  const out = lightOut();
  if (!out) return;
  const now = performance.now();
  nextAt = Math.max(now, nextAt + PACE);
  try { out.send(msg, nextAt > now + 0.5 ? nextAt : undefined); } catch {}
}
const ch = () => (Math.min(16, Math.max(1, Number(settings.lightsChannel) || 1)) - 1);
function on(n, c) {
  if (midi.proto === 'one') send([0xa2, n - 21, c]);
  else send([0x90 | ch(), n, c === 1 ? 64 : 100]); // velocity: some keyboards light the two hands differently by it
}
function off(n) {
  if (midi.proto === 'one') send([0xa2, n - 21, 0]);
  else send([0x80 | ch(), n, 0]);
}
// every light off: each key we lit (sweep: every key there is, to be sure: a song ended, the page is going away).
// (The ONE's "all lights off" SysEx alone isn't enough: it can be ignored until the keyboard's had a session started.)
export function allOff(sweep = false) {
  // a sweep: the keys the keyboard has (keyboardRange), and any lit outside it
  const kr = keyboardRange() || [21, 108];
  const keys = sweep ? [...new Set([...Array.from({ length: kr[1] - kr[0] + 1 }, (_, i) => i + kr[0]), ...lit.keys()])] : [...lit.keys()];
  for (const n of keys) off(n);
  if (midi.proto === 'one' && sysex) send([0xf0, 0x00, 0x20, 0x2b, 0x69, 0x16, 0x02, 0x00, 0xf7]);
  if (midi.proto === 'notes') send([0xb0 | ch(), 123, 0]);
  lit.clear();
}
// want: Map note -> colour (1 left / red, 2 right / blue). restrike: notes struck again, to blink off and on.
export function setLights(want, restrike = []) {
  if (!midi.lights) return;
  for (const [n] of lit) if (!want.has(n)) { off(n); lit.delete(n); }
  for (const n of restrike) if (lit.has(n)) { off(n); lit.delete(n); }
  for (const [n, c] of want) {
    if (n < 21 || n > 108 || lit.get(n) === c) continue;
    on(n, c);
    lit.set(n, c);
  }
}

// Settings' "Test": run up a C major scale and back off
export async function testLights() {
  if (!midi.lights) return;
  allOff();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  for (const n of scale) { on(n, n < 65 ? 1 : 2); lit.set(n, 1); await sleep(140); }
  await sleep(700);
  allOff(true);
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => allOff(true));
if (typeof window !== 'undefined') window.__yargMidi = { midi, held }; // for poking at from the devtools console
