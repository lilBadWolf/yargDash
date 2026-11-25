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
  mode: 'lyrics',                // dashboard: lyrics | tab | lanes | keys | click, last picked on this device
  libSort: 'artist',             // library: artist | title | added | played | year | length
  libFilter: 'all',              // library: all | tab | notab | proGuitar | proBass | proKeys | keys | played | unplayed
};

let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
export const settings = reactive({ ...defaults, ...saved });
for (const k of Object.keys(settings)) if (!(k in defaults)) delete settings[k]; // drop retired keys

watch(settings, (s) => {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}, { deep: true });

export function resetSettings() { Object.assign(settings, defaults, { lanesHidden: [] }); }
