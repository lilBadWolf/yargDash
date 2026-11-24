<script setup>
// QR code that opens a performer page (no controls) on a phone, e.g. the lyrics for singers.
import { ref, computed } from 'vue';
import Modal from './Modal.vue';
import { pageUrl, qrSvg, shareHost } from '../lib/qr.js';
import { closeModal } from '../lib/modal.js';

const props = defineProps({
  hash: { type: String, default: '' },      // the page, e.g. '#stage'
  title: { type: String, default: '' },
  what: { type: String, default: '' },      // one line describing what the page shows
});
const url = computed(() => pageUrl(props.hash));
const qr = computed(() => qrSvg(url.value));
const copied = ref(false);
const local = computed(() => /^(localhost|127\.)/.test(shareHost()));
function preview() { closeModal(); location.hash = props.hash; }
async function copy() {
  try { await navigator.clipboard.writeText(url.value); copied.value = true; setTimeout(() => (copied.value = false), 1500); } catch {}
}
</script>

<template>
  <Modal :title="title" subtitle="Scan to open on your phone" width="460px" @close="closeModal">
    <div class="wrap">
      <div class="qr">
        <svg :viewBox="qr.viewBox" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff" /><path :d="qr.d" fill="#0b0d10" /></svg>
      </div>

      <p v-if="what" class="what">{{ what }}</p>

      <div v-if="local" class="warn">This link uses this computer's local address, so phones can't open it. Set the address in Settings → QR codes.</div>
      <div class="url"><code>{{ url }}</code><button @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button></div>
      <p class="hint">The phone must be on the same Wi-Fi as this computer. Tip: Add to Home Screen for one-tap access.</p>
      <button class="preview" @click="preview">Preview</button>
    </div>
  </Modal>
</template>

<style scoped>
.wrap { display: flex; flex-direction: column; align-items: stretch; gap: 14px; }
.qr { align-self: center; width: min(100%, 300px); aspect-ratio: 1; padding: 0; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px #0008; }
.qr svg { display: block; width: 100%; height: 100%; }
.what { margin: 0; text-align: center; font-size: 14px; color: var(--muted); }
.what b { color: var(--text); }
.url { display: flex; gap: 8px; align-items: center; }
.url code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 8px 10px; border-radius: 8px; background: var(--bg); font-size: 12px; }
.url button, .preview { height: 34px; padding: 0 12px; border-radius: 8px; background: var(--btn); border: 1px solid var(--line); color: var(--text); font-weight: 700; font-size: 12px; }
.preview { align-self: center; }
.hint { margin: 0; font-size: 12px; color: var(--muted); text-align: center; }
.warn { background: #3a2a0c; border: 1px solid #6b4d12; color: #f5cf7a; padding: 8px 12px; border-radius: 10px; font-size: 13px; }
</style>
