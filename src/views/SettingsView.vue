<script setup>
import { ref, computed, onActivated } from 'vue';
import { settings, resetSettings } from '../lib/settings.js';
import { conn, connect, post } from '../lib/conn.js';
import { yarg } from '../lib/yarg.js';
import { library, loadLibrary, rescanLibrary } from '../lib/library.js';
import { encoreStatus } from '../lib/encore.js';
import { shareHost, pageUrl, qrSvg } from '../lib/qr.js';
import { go } from '../lib/router.js';
import logo from '../assets/logo.svg';
import StartYarg from '../components/StartYarg.vue';
import FxPreview from '../components/FxPreview.vue';
import { midi, testLights, noteName, keyboardSize, keyboardRange } from '../lib/midi.js';
import { useMidi } from '../lib/keyslights.js';
import { FX, FX_COLOURS } from '../lib/keysfx.js';

const TABS = [['general', 'General'], ['library', 'Library'], ['keys', 'Keys & MIDI']];
const tab = computed(() => (TABS.some(([k]) => k === settings.settingsTab) ? settings.settingsTab : 'general'));
const kbSize = computed(() => keyboardSize());
const kbRange = computed(() => keyboardRange());
const amtName = (a) => (a <= 0.5 ? 'Subtle' : a <= 1.2 ? 'Normal' : a <= 2 ? 'Big' : 'Wild');
const port = location.port || '80';
const version = __APP_VERSION__;

// server settings shown here (config.json on the server)
const streamLocal = ref(false);
const tabsDir = ref(''), dataDir = ref('');
// each visit (the view stays alive in between, see App.vue)
onActivated(async () => {
  loadLibrary();
  try {
    const st = await (await fetch('/status')).json();
    streamLocal.value = !!st.config?.streamLocal; yargDir.value = st.config?.yargDir || '';
    dataDir.value = st.data || ''; tabsDir.value = st.tabsDir || (st.data ? `${st.data}/tabs` : '');
    encoreDir.value = st.config?.encoreDir || '';
  } catch {}
  loadEncore();
});
// show the tab library / data folder on the YARG computer (Finder, Explorer…)
const openFolder = (which) => post('/folder/open', { which });
const localMsg = ref('');
async function saveStreamLocal() {
  await post('/config', { streamLocal: streamLocal.value });
  localMsg.value = 'Saved: applies the next time yargDash starts YARG.';
  setTimeout(() => (localMsg.value = ''), 5000);
}

const mac = computed(() => conn.platform === 'darwin');
const stream = computed(() => yarg.detected && yarg.clock.stream);
// On a Mac, YARG's stream only gets through when yargDash starts YARG: that step comes first, with the button.
// What YARG needs: to be running, with its data stream on. On a Mac that refuses YARG's broadcast (YARG logs
// "Error sending UDP packet"), YARG also needs restarting with yargDash's fix: that's only suggested then.
const streamHint = computed(() => {
  if (stream.value) return '';
  if (yarg.streamBlocked) {
    return mac.value
      ? `YARG is trying to send its stream, but macOS is blocking it. ${yarg.local ? 'Restart YARG with yargDash’s fix:' : 'Restart YARG with the fix from Settings on the YARG computer.'}`
      : 'YARG is trying to send its stream, but it isn’t getting out (YARG logs “Error sending UDP packet”). Check the firewall.';
  }
  let h = 'In YARG: Settings → All Settings → Experimental → Enable UDP Data Stream (once).';
  if (mac.value && conn.app && yarg.detected) h += ' On and still nothing? macOS may be keeping yargDash off the local network: turn yargDash on in System Settings → Privacy & Security → Local Network, then quit and reopen yargDash.';
  return h;
});
const steps = computed(() => [
  { ok: yarg.detected, title: 'YARG is running', hint: yarg.detected ? '' : 'Start YARG on this computer.', start: !yarg.detected },
  { ok: stream.value, title: 'YARG’s data stream is on', hint: streamHint.value, start: !stream.value && yarg.streamBlocked && mac.value },
]);

// Encore downloads: where they go
const enc = ref(null), encoreDir = ref(''), encMsg = ref('');
async function loadEncore() { try { enc.value = await encoreStatus(); } catch {} }
async function applyEncoreDir() {
  await post('/config', { encoreDir: encoreDir.value });
  await loadEncore();
  encMsg.value = encoreDir.value ? 'Saved.' : 'Back to automatic.';
  setTimeout(() => (encMsg.value = ''), 3000);
}

const yargDir = ref('');
const dirMsg = ref('');
async function applyDir() { await post('/config', { yargDir: yargDir.value }); dirMsg.value = yargDir.value ? 'Saved.' : 'Back to automatic.'; setTimeout(() => (dirMsg.value = ''), 3000); }

// Restart the server (on the YARG computer only): pages reconnect by themselves
const restartMsg = ref('');
async function restartServer() {
  restartMsg.value = 'Restarting…';
  try {
    const r = await fetch('/restart', { method: 'POST' });
    restartMsg.value = r.ok ? 'Restarted: reconnecting…' : `Failed (${r.status})`;
  } catch { restartMsg.value = 'Server unreachable'; }
  setTimeout(() => { restartMsg.value = ''; }, 6000);
}

const shareUrl = computed(() => pageUrl(''));
const qr = computed(() => qrSvg(shareUrl.value));
const copied = ref(false);
async function copy() { try { await navigator.clipboard.writeText(shareUrl.value); copied.value = true; setTimeout(() => (copied.value = false), 1500); } catch {} }

const nudge = (d) => { settings.lyricsOffsetMs = Math.round(((settings.lyricsOffsetMs || 0) + d) / 10) * 10; };
const ago = (ms) => {
  if (!ms) return 'not yet';
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
const confirmReset = () => { if (confirm('Reset this device’s settings (text sizes, parts shown, note speed…)?')) resetSettings(); };
</script>

<template>
  <div class="settings">
    <div class="wrap">
      <!-- status -->
      <section class="hero">
        <div class="brand">
          <img class="logo" :src="logo" alt="" draggable="false" />
          <div>
            <div class="name">yargDash <small>v{{ version }}</small></div>
            <div class="sub">{{ conn.app ? 'Desktop app' : 'Server' }} on {{ shareHost() }}</div>
          </div>
        </div>
        <div class="tiles">
          <div class="tile" :class="conn.connected ? 's-ok' : 's-bad'">
            <span class="led" /><div><b>Server</b><small>{{ conn.connected ? 'Connected' : 'Unreachable' }}</small></div>
          </div>
          <div class="tile" :class="stream ? 's-ok' : yarg.detected ? 's-warn' : 's-bad'">
            <span class="led" /><div><b>YARG</b><small>{{ !yarg.detected ? 'Not running' : stream ? 'Following songs' : 'No data stream' }}</small></div>
          </div>
          <button class="tile link" @click="go('library')">
            <span class="led lib" /><div><b>Library</b><small>{{ library.songs.length ? `${library.songs.length.toLocaleString()} songs` : library.scanning ? 'Reading…' : 'No songs' }}</small></div>
          </button>
        </div>
      </section>

      <!-- tabs (the last one open is kept per device) -->
      <div class="tabs" role="tablist">
        <button v-for="[k, l] in TABS" :key="k" role="tab" :class="{ on: tab === k }" @click="settings.settingsTab = k">{{ l }}</button>
      </div>

      <div class="grid">
        <!-- YARG -->
        <section v-show="tab === 'general'">
          <h3><svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>Connect YARG</h3>
          <ol class="steps">
            <li v-for="(st, i) in steps" :key="i" :class="{ ok: st.ok }">
              <span class="check">{{ st.ok ? '✓' : i + 1 }}</span>
              <div class="stc"><b>{{ st.title }}</b><p v-if="st.hint">{{ st.hint }}</p><StartYarg v-if="st.start" class="startbtn" /></div>
            </li>
          </ol>
          <details v-if="mac && yarg.local" :open="streamLocal">
            <summary>Stream not reaching yargDash?</summary>
            <p class="hint">YARG’s stream is on but yargDash doesn’t hear it? First turn on <b>yargDash</b> in System Settings → Privacy & Security → Local Network and reopen it. If that doesn’t help:</p>
          <label class="toggle">
            <input v-model="streamLocal" type="checkbox" @change="saveStreamLocal" />
            <span><b>Send YARG’s stream to this Mac only</b>
              <span class="hint">YARG’s stream then stays on this Mac, so it needs no permission, but only one program here can receive it (not yargDash and the REAPER bridge at once), and no other computer. Takes effect when yargDash next starts YARG.</span>
              <span v-if="localMsg" class="hint ok">{{ localMsg }}</span>
              <span v-if="streamLocal" class="hint">yargDash starts YARG with its fix for this: use Start YARG here (or in the menu bar), not the YARC Launcher.</span>
            </span>
          </label>
          </details>
          <details>
            <summary>YARG data folder</summary>
            <p class="hint">Only if YARG keeps its data somewhere unusual: the folder with <code>currentSong.json</code> and <code>settings.json</code>. Blank = automatic.</p>
            <div class="inline"><input v-model="yargDir" placeholder="(automatic)" spellcheck="false" /><button @click="applyDir">Apply</button></div>
            <p v-if="dirMsg" class="hint ok">{{ dirMsg }}</p>
          </details>
        </section>

        <!-- library -->
        <section v-show="tab === 'library'">
          <h3><svg viewBox="0 0 24 24"><path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.8 1 -3.6 14.5 -3.8-1z" /></svg>Song library</h3>
          <p class="hint">yargDash reads the song folders YARG uses (YARG: <i>Settings → Songs</i>). <code>.sng</code> files and folders with a <code>song.ini</code> are listed.</p>
          <ul class="folders">
            <li v-for="f in library.folders" :key="f"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg><span>{{ f }}</span></li>
            <li v-if="!library.folders.length" class="none">{{ library.error || 'No song folders found' }}</li>
          </ul>
          <div class="row">
            <span class="hint">{{ library.songs.length.toLocaleString() }} songs · checked {{ ago(library.scannedAt) }}</span>
            <span class="sp" />
            <button :disabled="library.scanning" @click="rescanLibrary">{{ library.scanning ? 'Scanning…' : 'Rescan' }}</button>
            <button class="primary" @click="go('library')">Browse</button>
          </div>
        </section>

        <!-- tab library -->
        <section v-show="tab === 'library'">
          <h3><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>Tab library</h3>
          <p class="hint">Your Guitar Pro files, and each song's bar offset and tunings (<code>index.json</code>), are kept in this folder. To back them up, copy the folder (or zip it). To restore or move them to another computer, copy its contents back while yargDash is closed. Settings and the log are in the data folder, one level up.</p>
          <ul class="folders">
            <li><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg><span class="tail" :title="tabsDir">{{ tabsDir ? `\u200e${tabsDir}\u200e` : '…' }}</span></li>
          </ul>
          <div v-if="yarg.local" class="row">
            <span class="sp" />
            <button @click="openFolder('data')">Open data folder</button>
            <button class="primary" @click="openFolder('tabs')">Open tab folder</button>
          </div>
          <p v-else class="hint">The buttons to open it are in Settings on the YARG computer.</p>
        </section>

        <!-- Encore downloads -->
        <section v-show="tab === 'library'">
          <h3><svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" /></svg>Encore downloads</h3>
          <p class="hint">Charts you download from Chorus Encore (Library → Get more from Encore) go into this song folder{{ enc?.downloaded ? ` (${enc.downloaded} so far)` : '' }}. YARG only sees them after you rescan songs in YARG.</p>
          <ul class="folders">
            <li><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg><span class="tail" :title="enc?.folder">{{ enc?.folder ? `\u200e${enc.folder}\u200e` : enc ? 'No YARG song folder yet' : '…' }}</span></li>
          </ul>
          <p v-if="enc?.folder && !enc.inSongFolders" class="hint warn">This folder isn’t inside one of YARG’s song folders, so YARG and the Library won’t see what you download. Add it in YARG (Settings → Songs) or pick a folder inside one.</p>
          <div v-if="yarg.local" class="row">
            <span class="sp" />
            <button :disabled="!enc?.folder" @click="openFolder('encore')">Open folder</button>
          </div>
          <details v-if="yarg.local">
            <summary>Download somewhere else</summary>
            <p class="hint">Blank = YARG’s first song folder.</p>
            <div class="inline"><input v-model="encoreDir" placeholder="(automatic)" spellcheck="false" /><button @click="applyEncoreDir">Apply</button></div>
            <p v-if="encMsg" class="hint ok">{{ encMsg }}</p>
          </details>
        </section>

        <!-- phones -->
        <section v-show="tab === 'general'">
          <h3><svg viewBox="0 0 24 24"><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></svg>Phones & screens</h3>
          <div class="share">
            <button class="qr" title="Copy the link" @click="copy">
              <svg :viewBox="qr.viewBox" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff" /><path :d="qr.d" fill="#0b0d10" /></svg>
            </button>
            <div class="sharetext">
              <p class="hint">Scan to open the dashboard on a phone or tablet on the same network. Performer pages: the QR button on the dashboard.</p>
              <button class="url" @click="copy">{{ copied ? 'Copied!' : shareUrl }}</button>
            </div>
          </div>
          <label>Address phones use <span class="hint">blank = automatic</span>
            <input v-model.trim="settings.qrHost" :placeholder="shareHost()" spellcheck="false" />
          </label>
          <div class="chips">
            <button v-for="a in conn.lan" :key="a.ip" class="chip" :class="{ on: settings.qrHost === `${a.ip}:${port}` }" @click="settings.qrHost = settings.qrHost === `${a.ip}:${port}` ? '' : `${a.ip}:${port}`">{{ a.ip }} <small>{{ a.name }}</small></button>
          </div>
        </section>

        <!-- this device -->
        <section v-show="tab === 'general'">
          <h3><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>This device</h3>
          <div class="field">
            <div><b>Lyrics timing</b><p class="hint">Lyrics early or late on this device (e.g. a slow phone)? + shows them earlier.</p></div>
            <div class="stepper">
              <button aria-label="Later" @click="nudge(-50)">−</button>
              <span><b>{{ settings.lyricsOffsetMs > 0 ? '+' : '' }}{{ settings.lyricsOffsetMs || 0 }}</b> ms</span>
              <button aria-label="Earlier" @click="nudge(50)">+</button>
            </div>
          </div>
          <div class="field">
            <div><b>Reset this device</b><p class="hint">Text sizes, parts shown, note speed and the like are kept per device.</p></div>
            <button class="ghost" @click="confirmReset">Reset</button>
          </div>
        </section>

        <!-- keys & midi: the keyboard -->
        <section v-show="tab === 'keys'">
          <h3><svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M7 6v7M12 6v7M17 6v7M7 18v-5M12 18v-5M17 18v-5" /></svg>MIDI keyboard</h3>
          <p v-if="midi.status === 'unsupported'" class="hint warn">This browser can't use MIDI. Use Chrome, Edge or the yargDash app on the computer the keyboard's plugged into.</p>
          <template v-else>
            <p class="hint">Plug any MIDI keyboard into this computer: the keys you press show in the Keys view (amber, or white-outlined when it's the right note).</p>
            <label class="toggle"><input type="checkbox" :checked="useMidi" @change="settings.keysMidi = $event.target.checked" />
              <span><b>Use a MIDI keyboard on this device</b><span class="hint">{{ settings.keysMidi == null ? 'On by itself on the YARG computer.' : '' }}</span></span></label>
            <p v-if="midi.status === 'denied'" class="hint warn">MIDI isn't allowed here: {{ midi.error }}</p>
            <template v-if="useMidi && midi.status === 'ready'">
              <label>Listen to
                <select v-model="settings.midiInput">
                  <option value="">Every MIDI keyboard{{ midi.allInputs.length ? ` (${midi.allInputs.join(', ')})` : '' }}</option>
                  <option v-for="n in midi.allInputs" :key="n" :value="n">{{ n }}</option>
                  <option v-if="settings.midiInput && !midi.allInputs.includes(settings.midiInput)" :value="settings.midiInput">{{ settings.midiInput }} (not plugged in)</option>
                </select>
              </label>
              <p v-if="!midi.allInputs.length" class="hint warn">No MIDI keyboard found. Plug one in: it shows up here by itself.</p>
              <p v-else class="hint" :class="{ ok: midi.last }">{{ midi.last ? `Last key: ${noteName(midi.last.note)} from ${midi.last.from} (velocity ${midi.last.vel})` : `Press a key to check it's heard${midi.count ? ` (${midi.count} other MIDI messages so far)` : ''}.` }}</p>
              <label class="toggle"><input v-model="settings.keysMatch" type="checkbox" />
                <span><b>Show your keyboard's keys in the Keys view</b><span class="hint">All its keys, laid out like the real thing, so you can see where your hands go. Notes it doesn't have are dimmed.</span></span></label>
              <div class="field">
                <div><b>Keyboard size</b><p class="hint">{{ kbRange ? `${noteName(kbRange[0])} to ${noteName(kbRange[1])}` : '' }}{{ kbSize.auto ? (kbSize.model ? ` · ${kbSize.model} has ${kbSize.keys} keys` : ` · ${kbSize.keys} keys, unless you pick its size`) : '' }}</p></div>
                <select v-model="settings.kbSize" class="narrow">
                  <option value="auto">Automatic</option>
                  <option v-for="k in [25, 32, 37, 49, 61, 76, 88]" :key="k" :value="String(k)">{{ k }} keys</option>
                </select>
              </div>
              <div class="field">
                <div><b>Octave</b><p class="hint">If you've moved it with the keyboard's octave buttons.</p></div>
                <div class="stepper">
                  <button aria-label="Down an octave" @click="settings.kbShift = Math.max(-3, (settings.kbShift || 0) - 1)">−</button>
                  <span><b>{{ settings.kbShift > 0 ? '+' : '' }}{{ settings.kbShift || 0 }}</b></span>
                  <button aria-label="Up an octave" @click="settings.kbShift = Math.min(3, (settings.kbShift || 0) + 1)">+</button>
                </div>
              </div>
            </template>
          </template>
        </section>

        <!-- keys & midi: key lights -->
        <section v-show="tab === 'keys'" v-if="midi.status !== 'unsupported'">
          <h3><svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></svg>Key lights</h3>
          <p class="hint">A keyboard with lights in its keys can light the notes to play, in any view: the Keys view's part, a moment before each note.</p>
          <template v-if="useMidi && midi.status === 'ready'">
            <label>Keyboard to light
              <select v-model="settings.lightsOut">
                <option value="">A The ONE keyboard, when one's plugged in</option>
                <option v-for="n in midi.allOutputs" :key="n" :value="n">{{ n }}</option>
                <option v-if="settings.lightsOut && !midi.allOutputs.includes(settings.lightsOut)" :value="settings.lightsOut">{{ settings.lightsOut }} (not plugged in)</option>
              </select>
            </label>
            <label>How it lights its keys
              <select v-model="settings.lightsProto">
                <option value="auto">Automatic</option>
                <option value="one">The ONE (Smart Piano, Piano COLOR, Light Keyboard)</option>
                <option value="notes">Sent the notes (Casio lighted keys, some Yamaha and others)</option>
              </select>
            </label>
            <label v-if="midi.proto === 'notes'">Channel <span class="hint">the one the keyboard lights its keys from. It may play the notes too: turn that channel down on the keyboard.</span>
              <select v-model.number="settings.lightsChannel"><option v-for="c in 16" :key="c" :value="c">{{ c }}</option></select>
            </label>
            <div class="field">
              <div><b>Light keys early</b><p class="hint">How long before its note a key lights.</p></div>
              <div class="stepper">
                <button aria-label="Later" @click="settings.lightsLead = Math.max(0, Math.round((settings.lightsLead - 0.05) * 100) / 100)">−</button>
                <span><b>{{ Math.round((settings.lightsLead || 0) * 1000) }}</b> ms</span>
                <button aria-label="Earlier" @click="settings.lightsLead = Math.min(1, Math.round((settings.lightsLead + 0.05) * 100) / 100)">+</button>
              </div>
            </div>
            <label class="toggle"><input v-model="settings.keysLights" type="checkbox" /><span><b>Light the keys</b><span class="hint">Also on the Keys view: the Lights button.</span></span></label>
            <div class="row">
              <button :disabled="!midi.lights" @click="testLights">Test lights</button>
              <span class="hint" :class="{ ok: midi.lights, warn: !midi.lights }">{{ midi.lights ? `Lighting ${midi.lights} (${midi.proto === 'one' ? 'The ONE' : `notes, channel ${settings.lightsChannel}`})` : settings.lightsOut ? `${settings.lightsOut} isn't plugged in` : 'No The ONE keyboard found: pick the keyboard above' }}</span>
            </div>
          </template>
          <p v-else class="hint">Turn on <b>Use a MIDI keyboard on this device</b> first.</p>
        </section>

        <!-- keys & midi: effects -->
        <section v-show="tab === 'keys'" class="wide">
          <h3><svg viewBox="0 0 24 24"><path d="M12 2l1.8 5.6L19 9.5l-5.2 1.9L12 17l-1.8-5.6L5 9.5l5.2-1.9zM19 15l.9 2.6 2.1.9-2.1.9L19 22l-.9-2.6-2.1-.9 2.1-.9z" /></svg>Keys view effects</h3>
          <div class="fxgrid">
            <div class="fxcol">
              <b>When a note reaches the keys</b>
              <div class="chips"><button v-for="[k, l] in FX" :key="k" class="chip" :class="{ on: settings.keysFx === k }" @click="settings.keysFx = k">{{ l }}</button></div>
              <label class="amt">How drastic <input v-model.number="settings.keysFxAmt" type="range" min="0.25" max="3" step="0.05" :disabled="settings.keysFx === 'none'" /><span>{{ amtName(settings.keysFxAmt) }}</span></label>
              <FxPreview which="land" />
            </div>
            <div class="fxcol">
              <b>When you play the right note <span class="hint">(MIDI keyboard)</span></b>
              <div class="chips"><button v-for="[k, l] in FX" :key="k" class="chip" :class="{ on: settings.keysHitFx === k }" @click="settings.keysHitFx = k">{{ l }}</button></div>
              <label class="amt">How drastic <input v-model.number="settings.keysHitFxAmt" type="range" min="0.25" max="3" step="0.05" :disabled="settings.keysHitFx === 'none'" /><span>{{ amtName(settings.keysHitFxAmt) }}</span></label>
              <FxPreview which="hit" />
            </div>
          </div>
          <div class="row">
            <span class="hint">Colours</span>
            <div class="chips"><button v-for="[k, l] in FX_COLOURS" :key="k" class="chip" :class="{ on: settings.keysFxColor === k }" @click="settings.keysFxColor = k">{{ l }}</button></div>
            <span class="sp" />
            <label class="amt">Glow on keys you press <input v-model.number="settings.keysPressGlow" type="range" min="0" max="2" step="0.1" /><span>{{ settings.keysPressGlow ? amtName(settings.keysPressGlow) : 'Off' }}</span></label>
          </div>
        </section>

        <!-- server -->
        <section v-show="tab === 'general'">
          <h3><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></svg>Server</h3>
          <dl>
            <dt>Connection</dt><dd :class="conn.connected ? 'ok' : 'bad'">{{ conn.connected ? 'Connected' : 'Unreachable' }}</dd>
            <dt>Build</dt><dd class="mono">{{ conn.code || '—' }}</dd>
            <dt>Running as</dt><dd>{{ conn.app ? 'yargDash app' : 'npm start' }}{{ conn.platform ? ` · ${{ darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[conn.platform] || conn.platform}` : '' }}</dd>
          </dl>
          <div class="row">
            <button @click="connect()">Reconnect</button>
            <button v-if="yarg.local" @click="restartServer">Restart server</button>
            <span v-if="restartMsg" class="hint">{{ restartMsg }}</span>
          </div>
        </section>
      </div>

      <p class="foot">yargDash v{{ version }} · not made by or affiliated with YARG · <a href="https://github.com/lilBadWolf/yargDash" target="_blank" rel="noopener">GitHub</a></p>
    </div>
  </div>
</template>

<style scoped>
.settings { height: 100%; overflow-y: auto; }
.wrap { max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; padding-bottom: 12px; }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }

.hero { flex-direction: row; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; background: radial-gradient(120% 140% at 0% 0%, #2c2042 0%, #14171c 60%); border-color: #3d2f55; }
.brand { display: flex; align-items: center; gap: 14px; }
.logo { width: 56px; height: 56px; display: block; filter: drop-shadow(0 6px 16px #8f5cff55); }
.name { font-size: 22px; font-weight: 800; letter-spacing: .01em; }
.name small { font-size: 12px; font-weight: 600; color: var(--muted); margin-left: 4px; }
.sub { font-size: 13px; color: var(--muted); margin-top: 2px; }
.tiles { display: flex; gap: 8px; flex-wrap: wrap; }
.tile { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 14px; background: #0b0d10a0; border: 1px solid var(--line); min-width: 150px; color: var(--text); text-align: left; font: inherit; }
.tile b { display: block; font-size: 13px; }
.tile small { color: var(--muted); font-size: 12px; }
.tile.link { height: auto; cursor: pointer; }
.tile.link:hover { border-color: #b48cff; }
.led { width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--mute); box-shadow: 0 0 10px var(--mute); }
.tile.s-ok .led { background: var(--ok); box-shadow: 0 0 10px var(--ok); }
.tile.s-warn .led { background: var(--solo); box-shadow: 0 0 10px var(--solo); }
.led.lib { background: #b48cff; box-shadow: 0 0 10px #b48cff; }

.tabs { display: flex; gap: 4px; padding: 4px; border-radius: 14px; background: var(--panel); border: 1px solid var(--line); align-self: flex-start; }
.tabs button { height: 36px; border: 0; background: none; color: var(--muted); border-radius: 10px; padding: 0 16px; }
.tabs button.on { background: var(--btn); color: var(--text); box-shadow: inset 0 -2px 0 #b48cff; }
.wide { grid-column: 1 / -1; }
.fxgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 16px; }
.fxcol { display: flex; flex-direction: column; gap: 10px; }
.fxcol > b { font-size: 14px; }
.amt { flex-direction: row; align-items: center; gap: 10px; font-weight: 600; color: var(--muted); }
.amt input { flex: 1; padding: 0; accent-color: #b48cff; min-width: 100px; }
.amt span { min-width: 52px; color: var(--text); font-size: 13px; }
select.narrow { flex: none; width: auto; }
select { background: var(--bg); border: 1px solid var(--line); color: var(--text); border-radius: 10px; padding: 9px 11px; font: inherit; font-weight: 400; min-width: 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr)); gap: 12px; align-items: start; }
h3 { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: var(--text); }
h3 svg { width: 18px; height: 18px; fill: none; stroke: #b48cff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.hint { color: var(--muted); font-size: 12.5px; margin: 0; line-height: 1.45; font-weight: 400; }
.hint.ok { color: var(--ok); }
.hint.warn { color: var(--solo); }

.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.steps li { display: flex; gap: 12px; align-items: flex-start; }
.check { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 800; background: #ffffff10; color: var(--muted); border: 1px solid var(--line); }
.steps li.ok .check { background: #10291c; color: var(--ok); border-color: #1d5c3a; }
.steps b { font-size: 14px; } .steps li.ok b { color: var(--muted); font-weight: 600; }
.stc { min-width: 0; flex: 1; }
.startbtn { margin-top: 8px; }
.steps p { margin: 3px 0 0; font-size: 12.5px; color: var(--muted); line-height: 1.45; }
details { border-top: 1px solid var(--line); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
details[open] { gap: 8px; }
details > * + * { margin-top: 8px; }
.toggle { flex-direction: row; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--bg); border: 1px solid var(--line); cursor: pointer; }
.toggle input { margin-top: 2px; width: 16px; height: 16px; accent-color: #b48cff; flex: none; padding: 0; }
.toggle > span { display: flex; flex-direction: column; gap: 3px; }
summary { cursor: pointer; font-size: 13px; font-weight: 600; color: var(--muted); }

.folders { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.folders li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; background: var(--bg); border: 1px solid var(--line); font-size: 13px; font-family: ui-monospace, Menlo, monospace; min-width: 0; }
.folders li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folders svg { width: 16px; height: 16px; flex: none; fill: none; stroke: var(--muted); stroke-width: 2; stroke-linejoin: round; }
.folders .none { font-family: inherit; color: var(--muted); }
.folders .tail { direction: rtl; text-align: left; } /* a long path: keep its end (the folder's name) in view */

.share { display: flex; gap: 14px; align-items: center; }
.qr { flex: none; width: 112px; height: 112px; padding: 0; border: 0; border-radius: 12px; overflow: hidden; background: #fff; }
.qr svg { width: 100%; height: 100%; display: block; }
.sharetext { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.url { align-self: flex-start; max-width: 100%; height: 32px; padding: 0 10px; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); color: var(--accent); font-family: ui-monospace, Menlo, monospace; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; }
label .hint { font-weight: 400; }
input { background: var(--bg); border: 1px solid var(--line); color: var(--text); border-radius: 10px; padding: 9px 11px; font: inherit; min-width: 0; outline: 0; }
input:focus { border-color: #b48cff; }
.inline { display: flex; gap: 6px; } .inline input { flex: 1; }
button { background: var(--btn); border: 1px solid var(--line); color: var(--text); border-radius: 10px; padding: 0 14px; height: 38px; font-weight: 700; }
button.primary { background: #b48cff; border-color: #b48cff; color: #160d26; }
button.ghost { color: var(--muted); }
button:disabled { opacity: .5; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sp { flex: 1; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { height: 32px; border-radius: 16px; font-weight: 600; font-size: 13px; }
.chip.on { border-color: var(--accent); color: var(--accent); }
.chip small { color: var(--muted); font-size: 10px; margin-left: 2px; }

.field { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.field b { font-size: 14px; }
.field .hint { margin-top: 2px; }
.stepper { flex: none; display: flex; align-items: center; gap: 4px; padding: 3px; border-radius: 12px; background: var(--bg); border: 1px solid var(--line); }
.stepper button { width: 34px; height: 32px; padding: 0; border-radius: 9px; font-size: 18px; }
.stepper span { min-width: 72px; text-align: center; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.stepper span b { color: var(--text); font-size: 15px; }

dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 14px; }
dt { color: var(--muted); } dd { margin: 0; }
.ok { color: var(--ok); } .bad { color: var(--mute); }
.mono { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
.foot { text-align: center; font-size: 12px; color: #5a636e; margin: 4px 0 0; }
.foot a { color: var(--muted); }

@media (max-width: 620px) {
  .hero { flex-direction: column; align-items: stretch; }
  .tile { flex: 1; min-width: 0; padding: 8px 10px; }
  .share { flex-direction: column; align-items: flex-start; }
}
</style>
