<script setup>
import { ref } from 'vue';
import { settings, resetSettings } from '../lib/settings.js';
import { conn, connect, post } from '../lib/conn.js';
import { yarg } from '../lib/yarg.js';
import { shareHost } from '../lib/qr.js';
const port = location.port || '80';
const version = __APP_VERSION__;

const yargDir = ref('');
// Restart the server (on the YARG computer only): it starts a fresh copy of itself; pages reconnect by themselves
const restartMsg = ref('');
async function restartServer() {
  restartMsg.value = 'Restarting…';
  try {
    const r = await fetch('/restart', { method: 'POST' });
    restartMsg.value = r.ok ? 'Restarted: reconnecting…' : `Failed (${r.status})`;
  } catch { restartMsg.value = 'Server unreachable'; }
  setTimeout(() => { restartMsg.value = ''; }, 6000);
}
</script>

<template>
  <div class="settings">
    <section>
      <h3>Status <span class="ver">yargDash v{{ version }}</span></h3>
      <dl>
        <dt>Server</dt><dd :class="conn.connected ? 'ok' : 'bad'">{{ conn.connected ? `Connected (${conn.code})` : 'Unreachable' }}</dd>
        <dt>YARG</dt><dd :class="yarg.detected ? 'ok' : 'bad'">{{ !yarg.detected ? 'Not running' : yarg.clock.stream ? 'Running · data stream on' : 'Running · data stream off' }}</dd>
      </dl>
      <div class="inline">
        <button @click="connect()">Reconnect</button>
        <button v-if="yarg.local" @click="restartServer">Restart server</button>
      </div>
      <p v-if="restartMsg" class="hint">{{ restartMsg }}</p>
    </section>

    <section>
      <h3>YARG</h3>
      <p class="hint">For everything to follow the song, turn on YARG's <b>Settings → All Settings → Experimental → Enable UDP Data Stream</b>. On a Mac, also start YARG with <code>npm run yarg</code> (or double-click <code>yarg/Start YARG.command</code>): macOS blocks YARG's stream otherwise.</p>
      <label>Lyrics timing on this device <span class="hint">ms · + shows lyrics earlier, − later</span>
        <input v-model.number="settings.lyricsOffsetMs" type="number" step="50" />
      </label>
      <label>YARG data folder <span class="hint">blank = automatic · the folder with currentSong.json</span>
        <div class="inline"><input v-model="yargDir" placeholder="(automatic)" /><button @click="post('/config', { yargDir })">Apply</button></div>
      </label>
    </section>

    <section>
      <h3>QR codes</h3>
      <p class="hint">Address phones use to reach this computer (dashboard → QR button). Blank = automatic.</p>
      <label>Address<input v-model.trim="settings.qrHost" :placeholder="shareHost()" /></label>
      <div class="chips">
        <button v-for="a in conn.lan" :key="a.ip" class="chip" :class="{ on: settings.qrHost === `${a.ip}:${port}` }" @click="settings.qrHost = `${a.ip}:${port}`">{{ a.ip }} <small>{{ a.name }}</small></button>
      </div>
    </section>

    <section>
      <h3>This device</h3>
      <p class="hint">Text sizes, the parts shown, note speed and so on are kept per device.</p>
      <button class="ghost" @click="resetSettings">Reset settings</button>
    </section>
  </div>
</template>

<style scoped>
.settings { height: 100%; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 12px; align-content: start; }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
h3 { margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; font-size: 14px; }
dt { color: var(--muted); }
.ver { float: right; text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 12px; } dd { margin: 0; }
.ok { color: var(--ok); } .bad { color: var(--mute); }
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.hint { color: var(--muted); font-size: 12px; margin: 0; }
input { background: var(--bg); border: 1px solid var(--line); color: var(--text); border-radius: 8px; padding: 9px 10px; font: inherit; min-width: 0; }
.inline { display: flex; gap: 6px; } .inline input { flex: 1; }
button { background: var(--btn); border: 1px solid var(--line); color: var(--text); border-radius: 8px; padding: 0 14px; height: 38px; font-weight: 600; }
button.ghost { align-self: start; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { height: 32px; border-radius: 16px; }
.chip.on { border-color: var(--accent); color: var(--accent); }
.chip small { color: var(--muted); font-size: 10px; }
</style>
