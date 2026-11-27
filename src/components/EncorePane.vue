<script setup>
// The Library's Encore side: search Chorus Encore (enchor.us) and download charts into YARG's song folders.
// Each chart says whether you have it (this exact chart is in the library) or have the song as another chart or version.
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { keepScroll } from '../lib/keepScroll.js';
import { encore, searchEncore, downloadChart, ENCORE_INSTRUMENTS } from '../lib/encore.js';
import { INSTRUMENTS, ROW_PARTS, TIER, fmtLength } from '../lib/library.js';
import { yarg } from '../lib/yarg.js';
import { settings } from '../lib/settings.js';
import InstIcon from './InstIcon.vue';

const INST = Object.fromEntries(INSTRUMENTS.map((i) => [i.key, i]));
const PRO_OF = { drums: 'proDrums' };
const searchEl = ref(null);
const broken = ref(new Set());
const hue = (s) => [...(s.artist || s.name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const pct = (j) => (j?.total ? Math.round((j.got / j.total) * 100) : 0);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const more = computed(() => encore.page < encore.pages);
const lastQ = computed(() => [encore.ran?.artist && `by ${encore.ran.artist}`, encore.ran?.q && `“${encore.ran.q}”`].filter(Boolean).join(' '));
const partTitle = (c, k) => (c.parts[k] != null && c.parts[k] >= 0 ? `${INST[k].label}: ${TIER[c.parts[k]] ?? '?'}` : c.parts[k] != null ? INST[k].label : `No ${INST[k].label.toLowerCase()}`);
const changed = (c) => (c.modified ? new Date(c.modified).toLocaleDateString() : '');

function state(c) {
  const j = encore.jobs[c.md5];
  if (j?.state === 'queued' || j?.state === 'downloading') return 'busy';
  if (c.downloaded || j?.state === 'done') return 'done';
  return j?.state === 'error' ? 'error' : 'none';
}
// load the next page when the end of the list comes into view
const list = ref(null), sentinel = ref(null);
let io = null;
onMounted(() => {
  searchEl.value?.focus();
  io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting) && more.value && !encore.error) searchEncore(true); }, { root: list.value, rootMargin: '400px' });
  if (sentinel.value) io.observe(sentinel.value);
});
// a short first page doesn't fill the list: the sentinel is already in view, so look again after each page
watch(() => encore.charts.length, () => { if (io && sentinel.value) { io.unobserve(sentinel.value); io.observe(sentinel.value); } }, { flush: 'post' });
onBeforeUnmount(() => io?.disconnect());
// it stays alive behind "My songs" (LibraryView): back, the results are where you left them, and the box ready to type in
const shown = () => settings.libSource === 'encore';
keepScroll(list, shown);
watch(shown, (v) => { if (v && !encore.charts.length) nextTick(() => searchEl.value?.focus()); });
</script>

<template>
  <div class="enc">
    <form class="bar" @submit.prevent="searchEncore()">
      <label class="search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
        <input ref="searchEl" v-model="encore.q" type="search" :placeholder="encore.artist.trim() ? 'Song name (optional)' : 'Search Chorus Encore: song, artist, album, charter…'" autocomplete="off" spellcheck="false" />
      </label>
      <label class="search artist">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4.5 4.2-6.5 8-6.5s7 2 8 6.5" /></svg>
        <input v-model="encore.artist" type="search" placeholder="Artist" autocomplete="off" spellcheck="false" aria-label="Artist" />
      </label>
      <select v-model="encore.instrument" class="sort" aria-label="Instrument" @change="encore.ran && searchEncore()">
        <option v-for="[k, l] in ENCORE_INSTRUMENTS" :key="k" :value="k">{{ l }}</option>
      </select>
      <button class="go" type="submit" :disabled="encore.loading || (!encore.q.trim() && !encore.artist.trim())">{{ encore.loading && !encore.charts.length ? 'Searching…' : 'Search' }}</button>
    </form>

    <div ref="list" class="list">
      <div v-if="encore.error" class="empty"><p>{{ encore.error }}</p></div>
      <div v-else-if="!encore.ran" class="empty">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
        <p>Find charts on <b>Chorus Encore</b> and download them straight into YARG’s song folders.</p>
        <p class="small">Charts already in your library are marked <span class="badge done">Downloaded</span>; songs you have as another chart or version are marked <span class="badge lib">In library</span>. After downloading, rescan songs in YARG to play them there.</p>
      </div>
      <div v-else-if="!encore.charts.length && !encore.loading" class="empty"><p>Nothing on Encore matches {{ lastQ }}.</p></div>

      <div v-for="c in encore.charts" :key="c.md5" class="row" :class="{ have: c.downloaded || c.inLibrary }">
        <div class="art" :style="{ '--h': hue(c) }">
          <img v-if="c.art && !broken.has(c.md5)" :src="c.art" loading="lazy" alt="" referrerpolicy="no-referrer" @error="broken.add(c.md5)" />
          <span v-else>{{ (c.name || '?').charAt(0) }}</span>
        </div>
        <div class="main">
          <div class="t"><span class="nm">{{ c.name }}</span>
            <span v-if="c.downloaded || encore.jobs[c.md5]?.state === 'done'" class="badge done" title="This exact chart is in your library">Downloaded</span>
            <span v-else-if="c.inLibrary" class="badge lib" title="You have this song as another chart or version">In library</span>
          </div>
          <div class="a">{{ c.artist }}<template v-if="c.album"> · {{ c.album }}</template><template v-if="c.year"> · {{ c.year }}</template></div>
          <div class="ch">by <b>{{ c.charter || 'unknown' }}</b><template v-if="changed(c)"> · {{ changed(c) }}</template></div>
        </div>
        <div class="parts">
          <span v-for="k in ROW_PARTS" :key="k" class="p" :class="{ off: c.parts[k] == null, pro: c.parts[PRO_OF[k]] != null }" :style="{ '--c': INST[k].color }" :title="partTitle(c, k)">
            <InstIcon :name="INST[k].icon" />
          </span>
        </div>
        <div class="len">{{ fmtLength(c.length) }}</div>
        <div class="act">
          <template v-if="state(c) === 'busy'">
            <div class="prog" :title="encore.jobs[c.md5].total ? `${mb(encore.jobs[c.md5].got)} of ${mb(encore.jobs[c.md5].total)}` : 'Waiting'"><i :style="{ width: `${pct(encore.jobs[c.md5])}%` }" /></div>
            <small>{{ encore.jobs[c.md5].state === 'queued' ? 'Queued' : `${pct(encore.jobs[c.md5])}%` }}</small>
          </template>
          <span v-else-if="state(c) === 'done'" class="ok">✓</span>
          <template v-else-if="yarg.local">
            <button class="dl" :class="{ again: c.inLibrary }" :title="c.inLibrary ? 'You have this song as another chart or version: download this one too' : 'Download into YARG’s song folder'" @click="downloadChart(c)">
              {{ state(c) === 'error' ? 'Retry' : 'Download' }}
            </button>
            <small v-if="state(c) === 'error'" class="err" :title="encore.jobs[c.md5].error">{{ encore.jobs[c.md5].error }}</small>
          </template>
        </div>
      </div>

      <div ref="sentinel" class="sentinel" />
      <div v-if="more || (encore.loading && encore.charts.length)" class="morebox"><button class="go" :disabled="encore.loading" @click="searchEncore(true)">{{ encore.loading ? 'Loading…' : 'More results' }}</button></div>
      <p v-if="encore.charts.length" class="foot">{{ encore.charts.length }} chart{{ encore.charts.length === 1 ? '' : 's' }}{{ encore.unit === 'songs' ? ` of ${encore.found} song${encore.found === 1 ? '' : 's'}` : encore.found > encore.charts.length ? ` of ${encore.found}` : '' }} · from <a href="https://www.enchor.us" target="_blank" rel="noopener">Chorus Encore</a><template v-if="!yarg.local"> · download from the YARG computer</template></p>
    </div>
  </div>
</template>

<style scoped>
.enc { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.bar { display: flex; gap: 8px; align-items: center; }
.search { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 12px; border-radius: 14px; background: var(--panel); border: 1px solid var(--line); transition: border-color .15s, box-shadow .15s; }
.search:focus-within { border-color: #b48cff; box-shadow: 0 0 0 3px #b48cff22; }
.search svg { width: 18px; height: 18px; fill: none; stroke: var(--muted); stroke-width: 2.2; stroke-linecap: round; flex: none; }
.search.artist { flex: 0 1 240px; }
.search input { flex: 1; min-width: 0; height: 100%; background: transparent; border: 0; outline: 0; color: var(--text); font: inherit; font-size: 15px; }
.sort { height: 44px; border-radius: 14px; background: var(--panel); border: 1px solid var(--line); color: var(--text); font: inherit; font-weight: 600; padding: 0 10px; }
.go { height: 44px; padding: 0 16px; border-radius: 14px; border: 0; background: #b48cff; color: #160d26; font-weight: 800; }
.go:disabled { opacity: .5; }
.list { flex: 1; min-height: 0; overflow-y: auto; border-radius: 16px; background: var(--panel); border: 1px solid var(--line); padding: 6px; }
.row { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto 48px 110px; align-items: center; gap: 14px; padding: 7px 10px; border-radius: 12px; }
.row:hover { background: #ffffff08; }
.art { width: 48px; height: 48px; border-radius: 9px; overflow: hidden; background: linear-gradient(135deg, hsl(var(--h) 45% 32%), hsl(calc(var(--h) + 40) 40% 18%)); display: grid; place-items: center; box-shadow: 0 2px 8px #0006; }
.art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.art span { font-size: 20px; font-weight: 800; color: #ffffffc0; }
.main { min-width: 0; }
.t { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; }
.nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.a, .ch { margin-top: 2px; font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ch { font-size: 12px; }
.ch b { color: var(--text); font-weight: 600; }
.badge { flex: none; display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; padding: 3px 7px; border-radius: 6px; }
.badge.done { background: #10291c; color: var(--ok); }
.badge.lib { background: #0f2a2a; color: var(--accent); }
.parts { display: flex; gap: 4px; }
.p { position: relative; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; font-size: 16px; color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); }
.p.off { color: #ffffff24; background: transparent; }
.p.pro::after { content: ''; position: absolute; top: 3px; right: 3px; width: 5px; height: 5px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 1.5px var(--panel); }
.len { text-align: right; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.act { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; min-width: 0; }
.act small { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.act .err { color: var(--solo); max-width: 110px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dl { height: 32px; padding: 0 12px; border-radius: 9px; border: 1px solid #b48cff; background: #b48cff1f; color: #e2d4ff; font-weight: 800; font-size: 13px; }
.dl.again { border-color: var(--line); background: var(--btn); color: var(--muted); }
.ok { color: var(--ok); font-size: 20px; font-weight: 800; padding-right: 10px; }
.prog { width: 90px; height: 6px; border-radius: 3px; background: #ffffff14; overflow: hidden; }
.prog i { display: block; height: 100%; background: #b48cff; transition: width .25s linear; }
.sentinel { height: 1px; }
.morebox { display: flex; justify-content: center; padding: 10px; }
.morebox .go { background: var(--btn); color: var(--text); border: 1px solid var(--line); }
.foot { text-align: center; color: var(--muted); font-size: 12px; margin: 10px 0 6px; }
.foot a { color: #b48cff; }
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 60px 20px; color: var(--muted); text-align: center; }
.empty > svg { width: 40px; height: 40px; fill: none; stroke: #b48cff; stroke-width: 1.8; stroke-linecap: round; opacity: .7; }
.empty p { margin: 0; max-width: 520px; } .empty .small { font-size: 13px; line-height: 1.6; }
@media (max-width: 860px) {
  .row { grid-template-columns: 48px minmax(0, 1fr) auto 96px; }
  .len { display: none; }
}
@media (max-width: 620px) {
  .row { grid-template-columns: 44px minmax(0, 1fr) 84px; gap: 10px; padding: 6px; }
  .parts { display: none; }
  .sort { max-width: 110px; }
  .bar { flex-wrap: wrap; }
  .search { flex-basis: 100%; }
  .search.artist { flex: 1 1 0; }
}
</style>
