// Keep a scrolling element's place while its view is hidden (KeepAlive, or v-show): a browser forgets an element's
// scroll position when it leaves the page or stops being displayed, so remember it as it scrolls and put it back.
import { watch, nextTick, onActivated } from 'vue';

export function keepScroll(elRef, shown = () => true) {
  let top = 0, holdUntil = 0;
  const save = () => {
    const el = elRef.value;
    // a hidden or detached element reports 0: not where the user was
    if (el && el.isConnected && el.offsetParent !== null && performance.now() > holdUntil) top = el.scrollTop;
  };
  const restore = () => nextTick(() => {
    const el = elRef.value;
    if (!el || !shown()) return;
    holdUntil = performance.now() + 200;
    el.scrollTop = top;
    requestAnimationFrame(() => { if (Math.abs(el.scrollTop - top) > 1) el.scrollTop = top; });
  });
  watch(elRef, (el, old) => {
    old?.removeEventListener('scroll', save);
    el?.addEventListener('scroll', save, { passive: true });
  }, { immediate: true, flush: 'post' });
  onActivated(restore);
  watch(shown, (v) => { if (v) restore(); });
  return { restore, reset: () => { top = 0; } };
}
