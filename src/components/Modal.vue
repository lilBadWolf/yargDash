<script setup>
// Bottom sheet on phones, centered dialog on larger screens.
import { onMounted, onBeforeUnmount } from 'vue';
defineProps({ title: { type: String, default: '' }, subtitle: { type: String, default: '' }, width: { type: String, default: '560px' } });
const emit = defineEmits(['close']);
const onKey = (e) => { if (e.key === 'Escape') emit('close'); };
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="backdrop" @pointerdown.self="emit('close')">
    <div class="sheet" :style="{ '--w': width }" role="dialog" aria-modal="true">
      <div class="grab" />
      <header>
        <div class="titles">
          <div v-if="subtitle" class="sub">{{ subtitle }}</div>
          <h2>{{ title }}</h2>
        </div>
        <slot name="actions" />
        <button class="x" aria-label="Close" @click="emit('close')"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      </header>
      <div class="body"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 50; background: #000a; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center; padding: 24px; animation: fade .15s ease-out; }
.sheet { width: min(100%, var(--w)); max-height: min(88vh, 900px); display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line);
  border-radius: 20px; box-shadow: 0 30px 80px #000c; animation: pop .18s cubic-bezier(.2, .9, .3, 1.2); overflow: hidden; }
.grab { display: none; }
header { display: flex; align-items: center; gap: 10px; padding: 16px 16px 12px 20px; border-bottom: 1px solid var(--line); }
.titles { flex: 1; min-width: 0; }
.sub { font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
h2 { margin: 2px 0 0; font-size: 18px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.x { flex: none; width: 40px; height: 40px; padding: 0; display: grid; place-items: center; border-radius: 12px; background: var(--btn); border: 1px solid var(--line); color: var(--text); }
.x svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; fill: none; }
.body { padding: 16px 20px 20px; overflow-y: auto; overscroll-behavior: contain; }
@keyframes fade { from { opacity: 0; } }
@keyframes pop { from { transform: scale(.96) translateY(8px); opacity: 0; } }
@keyframes up { from { transform: translateY(100%); } }

@media (max-width: 620px) {
  .backdrop { align-items: flex-end; padding: 0; }
  .sheet { width: 100%; max-height: 90vh; border-radius: 20px 20px 0 0; border-bottom: 0; animation: up .22s cubic-bezier(.2, .9, .3, 1); padding-bottom: env(safe-area-inset-bottom); }
  .grab { display: block; width: 40px; height: 4px; border-radius: 2px; background: #ffffff30; margin: 8px auto 0; }
  header { padding-top: 8px; }
}
</style>
