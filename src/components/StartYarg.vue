<script setup>
// "Start YARG" (macOS, on the YARG computer): yargDash starts YARG, with the fix for Macs that block YARG's data
// stream (POST /yarg/start, yarg/start-yarg.sh). YARG already running: restarts it with the fix. Shows nothing elsewhere.
import { ref, computed } from 'vue';
import { yarg } from '../lib/yarg.js';
import { conn } from '../lib/conn.js';

defineProps({ compact: { type: Boolean, default: false } });

const show = computed(() => conn.platform === 'darwin' && yarg.local);
const restart = computed(() => yarg.detected && !yarg.clock.stream);
const busy = ref(false), msg = ref(''), bad = ref(false), needPath = ref(false), appPath = ref('');

async function start(extra = {}) {
  if (restart.value && !extra.restart && !confirm('Restart YARG with yargDash’s fix so its stream gets through?\nLeave the song you’re in first: YARG quits and starts again.')) return;
  busy.value = true; msg.value = ''; bad.value = false;
  try {
    const r = await fetch('/yarg/start', { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ restart: restart.value, ...(needPath.value && appPath.value ? { app: appPath.value } : {}), ...extra }) });
    const j = r.status === 404 ? { ok: false, message: 'The server is out of date: restart it (Settings → Server) first.' } : await r.json();
    if (j.ok) { needPath.value = false; msg.value = 'Starting YARG… it can take a moment.'; }
    else if (j.code === 2) { needPath.value = true; bad.value = true; msg.value = 'Couldn’t find YARG.app. Paste its path (YARC Launcher’s “YARG Installs/…/installation/YARG.app”):'; }
    else { bad.value = true; msg.value = j.message || j.error || 'Couldn’t start YARG'; }
  } catch (e) { bad.value = true; msg.value = e.message; }
  busy.value = false;
}
</script>

<template>
  <div v-if="show" class="sy" :class="{ compact }">
    <button class="go" :disabled="busy" @click="start()">
      <svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" /></svg>{{ busy ? (restart ? 'Restarting YARG…' : 'Starting YARG…') : restart ? 'Restart YARG with the fix' : 'Start YARG' }}
    </button>
    <p v-if="msg" class="msg" :class="{ bad }">{{ msg }}</p>
    <div v-if="needPath" class="path">
      <input v-model.trim="appPath" placeholder="/Volumes/…/YARG Installs/…/installation/YARG.app" spellcheck="false" @keydown.enter="start()" />
      <button :disabled="busy || !appPath" @click="start()">Start</button>
    </div>
  </div>
</template>

<style scoped>
.sy { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.sy.compact { flex-direction: row; align-items: center; flex-wrap: wrap; }
.go { display: inline-flex; align-items: center; gap: 7px; height: 38px; padding: 0 16px 0 12px; border-radius: 10px; border: 1px solid #b48cff; background: #b48cff; color: #160d26; font-weight: 800; font-size: 13px; }
.go svg { width: 16px; height: 16px; fill: currentColor; }
.go:disabled { opacity: .6; }
.compact .go { height: 30px; font-size: 12px; padding: 0 12px 0 9px; }
.msg { margin: 0; font-size: 12.5px; color: var(--ok); }
.msg.bad { color: var(--solo); }
.path { display: flex; gap: 6px; width: 100%; }
.path input { flex: 1; min-width: 0; background: var(--bg); border: 1px solid var(--line); color: var(--text); border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 13px; }
.path button { height: 36px; padding: 0 14px; border-radius: 10px; background: var(--btn); border: 1px solid var(--line); color: var(--text); font-weight: 700; }
</style>
