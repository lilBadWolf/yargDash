<script setup>
// Pick one of a few options: a row of segment buttons, or a dropdown when the row it sits in has no room for them
// (`compact`, decided by the row: see fitRow() in lib/fit.js). Both forms are also rendered invisibly, so the row
// can measure them without switching back and forth.
import { ref } from 'vue';

const props = defineProps({
  options: { type: Array, required: true },   // [{ value, label, title? }]
  modelValue: { type: [String, Number], default: null },
  compact: { type: Boolean, default: false },
  label: { type: String, default: '' },       // shown before the dropdown
});
const emit = defineEmits(['update:modelValue']);

const fullEl = ref(null), compactEl = ref(null);
// natural widths of the buttons and of the dropdown, in px
defineExpose({ widths: () => ({ full: fullEl.value?.offsetWidth || 0, compact: compactEl.value?.offsetWidth || 0 }) });
const pick = (v) => { if (v !== props.modelValue) emit('update:modelValue', v); };
</script>

<template>
  <div class="segpick">
    <div v-if="!compact" class="seg">
      <button v-for="o in options" :key="o.value" :class="{ on: o.value === modelValue }" :title="o.title" @click="pick(o.value)">{{ o.label }}</button>
    </div>
    <label v-else class="pick">
      <span v-if="label">{{ label }}</span>
      <select :value="modelValue" :aria-label="label" @change="pick(options.find((o) => String(o.value) === $event.target.value)?.value)">
        <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
    </label>
    <div class="measure" aria-hidden="true">
      <div ref="fullEl" class="seg"><button v-for="o in options" :key="o.value" tabindex="-1">{{ o.label }}</button></div>
      <label ref="compactEl" class="pick"><span v-if="label">{{ label }}</span><select tabindex="-1"><option v-for="o in options" :key="o.value">{{ o.label }}</option></select></label>
    </div>
  </div>
</template>

<style scoped>
.segpick { position: relative; min-width: 0; }
.seg { display: flex; gap: 2px; padding: 3px; border-radius: 11px; background: var(--panel); border: 1px solid var(--line); width: max-content; }
.seg button { flex: none; height: 32px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-weight: 700; font-size: 13px; white-space: nowrap; }
.seg button.on { background: var(--btn); color: var(--text); box-shadow: inset 0 -2px 0 #b48cff; }
.pick { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); white-space: nowrap; width: max-content; }
.pick select { height: 38px; border-radius: 10px; background: var(--btn); border: 1px solid #b48cff88; color: var(--text); font: inherit; font-weight: 700; padding: 0 8px; max-width: 70vw; }
/* the invisible copies the row measures: clipped to nothing so they never take room or scroll */
.measure { position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: hidden; visibility: hidden; pointer-events: none; }
</style>
