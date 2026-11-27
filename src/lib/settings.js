// Per-device settings (this browser only), kept in localStorage.
import { reactive, watch } from 'vue';

const KEY = 'yargdash-settings';
const defaults = {
  qrHost: '',                    // address phones use to reach this computer ('' = auto)
  lyricsOffsetMs: 0,             // lyrics: + shows them earlier on this device, - later
  lyricsScale: 1,                // lyrics: text size on this device
  vocalPart: '',                 // lyrics: vocals | harm1 | harm2 | harm3 ('' = lead)
  pitchGuide: false,             // lyrics: show the pitch guide
  clickSound: false,             // click: also play a click on this device
  tabTrack: '',                  // tab: track id last picked on this device
  tabKind: 'guitar',             // tab: guitar | bass (used when that track id isn't in the next song)
  tabScale: 1,                   // tab: size on this device
  lanesSpeed: 1,                 // lanes: note speed on this device (1 = 1.6 s from the far end to the strike line)
  lanesHidden: [],               // lanes: parts not shown on this device (guitar | rhythm | bass | drums | keys)
  keysTrack: '',                 // keys: keyboard track id last picked on this device
  keysSpeed: 1,                  // keys: note speed on this device (1 = 2.4 s to fall)
  keysNames: true,               // keys: note names on the falling notes and keys
  keysMidi: null,                // keys: use a MIDI keyboard plugged into this device (null = only on the YARG computer)
  keysLights: true,              // keys: light the keys of a light-up keyboard as the notes are due
  keysFx: 'sparks',              // keys: effect where a note lands: sparks | flames | beams | ripples | fireworks | none (lib/keysfx.js)
  keysFxAmt: 1,                  // keys: how drastic (0.25 subtle … 3 wild)
  keysHitFx: 'flames',           // keys: effect when you play the right note on a MIDI keyboard
  keysHitFxAmt: 1,
  keysFxColor: 'hand',           // keys: effect colours: hand | fire | rainbow
  keysPressGlow: 1,              // keys: glow over the keys you press (0 = none … 2)
  midiInput: '',                 // MIDI keyboard to listen to ('' = all of them)
  lightsOut: '',                 // MIDI output whose keys light up ('' = a The ONE keyboard, when one is plugged in)
  lightsProto: 'auto',           // how to light its keys: auto (The ONE's way for a ONE, else notes) | one | notes
  lightsChannel: 1,              // notes: the MIDI channel (1–16) the keyboard lights its keys from
  lightsLead: 0.2,               // light a key this long (s) before its note
  kbSize: 'auto',                // MIDI keyboard's size: auto (known models, else 61) | 25 | 32 | 37 | 49 | 61 | 76 | 88
  kbShift: 0,                    // …moved this many octaves (its octave buttons)
  keysMatch: true,               // keys: show the MIDI keyboard's own keys (to place your hands), not just the part's range
  settingsTab: 'general',        // settings: the tab last open on this device
  mode: 'lyrics',                // dashboard: lyrics | tab | lanes | keys | click, last picked on this device
  libSort: 'artist',             // library: artist | title | added | played | year | length
  libFilter: 'all',              // library: all | tab | notab | proGuitar | proBass | proKeys | keys | played | unplayed
  libSource: 'mine',             // library: mine (YARG's songs) | encore (search Chorus Encore)
};

let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
export const settings = reactive({ ...defaults, ...saved });
for (const k of Object.keys(settings)) if (!(k in defaults)) delete settings[k]; // drop retired keys

watch(settings, (s) => {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}, { deep: true });

export function resetSettings() { Object.assign(settings, defaults, { lanesHidden: [] }); }
