<script setup>
import { ref, computed, onMounted } from 'vue';
import { settings, resetSettings } from '../lib/settings.js';
import { conn, connect, post } from '../lib/conn.js';
import { yarg } from '../lib/yarg.js';
import { library, loadLibrary, rescanLibrary } from '../lib/library.js';
import { shareHost, pageUrl, qrSvg } from '../lib/qr.js';
import { go } from '../lib/router.js';
import logo from '../assets/logo.svg';
import StartYarg from '../components/StartYarg.vue';
const port = location.port || '80';
const version = __APP_VERSION__;

// server settings shown here (config.json on the server)
const streamLocal = ref(false);
onMounted(async () => {
  loadLibrary();
  try { const st = await (await fetch('/status')).json(); streamLocal.value = !!st.config?.streamLocal; yargDir.value = st.config?.yargDir || ''; } catch {}
});
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

      <div class="grid">
        <!-- YARG -->
        <section>
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
        <section>
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

        <!-- phones -->
        <section>
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
        <section>
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

        <!-- server -->
        <section>
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

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr)); gap: 12px; align-items: start; }
h3 { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: var(--text); }
h3 svg { width: 18px; height: 18px; fill: none; stroke: #b48cff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.hint { color: var(--muted); font-size: 12.5px; margin: 0; line-height: 1.45; font-weight: 400; }
.hint.ok { color: var(--ok); }

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
