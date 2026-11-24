<script setup>
import { computed } from 'vue';
import DashView from './views/DashView.vue';
import SettingsView from './views/SettingsView.vue';
import QrModal from './components/QrModal.vue';
import { route, go } from './lib/router.js';
import { modal } from './lib/modal.js';
import { conn } from './lib/conn.js';
import { yarg } from './lib/yarg.js';

const current = computed(() => (route.view === 'settings' ? SettingsView : DashView));
const streamOk = computed(() => yarg.detected && yarg.clock.stream);

// Performer pages: hold the logo for a second to get back to the dashboard.
let holdTimer = 0;
const holdStart = () => { if (route.artist) holdTimer = setTimeout(() => { location.hash = ''; }, 1000); };
const holdEnd = () => clearTimeout(holdTimer);
</script>

<template>
  <div class="app" :class="{ artist: route.artist }">
    <header>
      <div class="brand" @pointerdown="holdStart" @pointerup="holdEnd" @pointerleave="holdEnd" @pointercancel="holdEnd">
        <span class="logo"><i /><i /><i /></span>
        <span class="title">yargDash</span>
        <span class="dots">
          <span class="dot" :class="{ ok: conn.connected }" title="yargDash server">SRV</span>
          <span class="dot" :class="{ ok: streamOk, warn: yarg.detected && !streamOk }" :title="!yarg.detected ? 'YARG not running' : streamOk ? 'YARG: data stream on' : 'YARG running, data stream off'">YARG</span>
        </span>
      </div>
      <nav v-if="!route.artist">
        <button :class="{ active: route.view === 'dash' }" @click="go('dash')">Dashboard</button>
        <button :class="{ active: route.view === 'settings' }" @click="go('settings')">Settings</button>
      </nav>
    </header>

    <main><component :is="current" /></main>

    <QrModal v-if="modal.kind === 'qr'" v-bind="modal.props" />
  </div>
</template>

<style scoped>
.app { height: 100%; width: 100%; overflow: hidden; display: flex; flex-direction: column; padding: max(10px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(3px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); gap: 10px; }
header { display: flex; align-items: center; gap: 12px 16px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 10px; margin-right: auto; user-select: none; -webkit-user-select: none; }
.logo { display: inline-flex; gap: 2px; align-items: flex-end; height: 18px; }
.logo i { width: 4px; border-radius: 2px; background: #b48cff; }
.logo i:nth-child(1) { height: 60%; } .logo i:nth-child(2) { height: 100%; } .logo i:nth-child(3) { height: 40%; }
.title { font-weight: 700; letter-spacing: .02em; font-size: 16px; }
.dots { display: flex; gap: 4px; }
.dot { font-size: 10px; font-weight: 700; letter-spacing: .06em; padding: 3px 6px; border-radius: 6px; background: #2a1414; color: #ff7a6e; }
.dot.ok { background: #10291c; color: var(--ok); }
.dot.warn { background: #33280c; color: var(--solo); }
nav { display: flex; gap: 2px; background: var(--panel); border: 1px solid var(--line); padding: 3px; border-radius: 12px; }
nav button { height: 36px; padding: 0 16px; border: 0; border-radius: 9px; background: transparent; color: var(--muted); font-weight: 600; }
nav button.active { background: var(--btn); color: var(--text); box-shadow: inset 0 -2px 0 #b48cff; }
main { flex: 1; min-height: 0; min-width: 0; }

/* performer page on a phone in landscape: a thin brand line (hold it to leave) */
@media (max-height: 500px) {
  .app.artist { gap: 4px; padding-top: max(4px, env(safe-area-inset-top)); }
  .app.artist .title { font-size: 12px; }
  .app.artist .logo { height: 12px; }
  .app.artist .dot { font-size: 9px; padding: 1px 5px; }
}
</style>
