// Keep a wrapping row's pickers (SegPick) on one line by turning them into dropdowns, one at a time in order of
// `pickers` (first collapses first), until the line fits. Widths come from each picker's invisible copies
// and from the row's other children, so the result doesn't depend on the current choice and never flips back and forth.
//   const compact = fitRow(rowRef, () => [['track', trackPickRef.value], ['view', viewPickRef.value]]);
//   <SegPick :compact="compact.track" ... />
import { reactive, onMounted, onUpdated, onBeforeUnmount } from 'vue';

export function fitRow(rowRef, pickers) {
  const compact = reactive({});
  let ro = null, watched = null;
  function fit() {
    const row = rowRef.value;
    if (row !== watched && ro) { if (watched) ro.unobserve(watched); if (row) ro.observe(row); watched = row; } // the row can come and go (v-if)
    if (!row) return;
    const list = pickers().filter(([, c]) => c?.$el?.isConnected && c.$el.parentElement === row);
    const els = new Set(list.map(([, c]) => c.$el));
    let kids = [...row.children].filter((el) => el.offsetWidth || el.offsetHeight);
    // the line that has to fit: up to the last picker, and the small chips right after it (Pitch, Names);
    // long controls after that (bar offset, tuning) go on the next line anyway
    let end = kids.findLastIndex((el) => els.has(el));
    while (end >= 0 && kids[end + 1] && !els.has(kids[end + 1]) && kids[end + 1].offsetWidth <= 110) end++;
    kids = kids.slice(0, end + 1);
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    let need = gap * Math.max(0, kids.length - 1);
    for (const el of kids) if (!els.has(el)) need += el.offsetWidth;
    const w = list.map(([k, c]) => [k, c.widths()]);
    for (const [, x] of w) need += x.full;
    const next = {};
    for (const [k, x] of w) {
      next[k] = need > row.clientWidth + 0.5;
      if (next[k]) need += x.compact - x.full;
    }
    for (const [k, v] of Object.entries(next)) if (compact[k] !== v) compact[k] = v;
  }
  onMounted(() => { ro = new ResizeObserver(() => fit()); fit(); });
  onUpdated(fit); // the row's contents change with the view, song and track
  onBeforeUnmount(() => ro?.disconnect());
  return compact;
}
