<script setup>
// Small line icons for instruments: guitar | bass | drums | keys | mic
defineProps({ name: { type: String, required: true } });
</script>

<template>
  <svg class="ii" viewBox="0 0 24 24" aria-hidden="true">
    <template v-if="name === 'guitar'"><circle cx="8.5" cy="15.5" r="4.6" /><circle cx="8.5" cy="15.5" r="1.1" class="f" /><path d="M11.8 12.2 19.6 4.4M17.8 2.8l3.4 3.4" /></template>
    <template v-else-if="name === 'bass'"><circle cx="7.4" cy="16.6" r="3.9" /><path d="M10.2 13.8 20.6 3.4M19 1.9l3.1 3.1M5.8 18.2l3.2-3.2" /></template>
    <template v-else-if="name === 'drums'"><ellipse cx="12" cy="10" rx="8" ry="3" /><path d="M4 10v5.5c0 1.7 3.6 3 8 3s8-1.3 8-3V10M7.5 3.5l3.2 5M16.5 3.5l-3.2 5" /></template>
    <template v-else-if="name === 'keys'"><rect x="3" y="5" width="18" height="14" rx="2.2" /><path d="M9 13v6M15 13v6" /><path d="M7.5 5v8h3V5M13.5 5v8h3V5" class="f" /></template>
    <template v-else><rect x="9" y="2.8" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" /></template>
  </svg>
</template>

<style scoped>
.ii { width: 1em; height: 1em; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.ii .f { fill: currentColor; stroke: none; }
</style>
