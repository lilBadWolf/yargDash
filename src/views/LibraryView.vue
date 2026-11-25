<script setup>
// YARG's songs: search, filter and sort; tap a song for what's in it and its tab (SongModal).
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { library, loadLibrary, rescanLibrary, artUrl, INSTRUMENTS, ROW_PARTS, TIER, fmtLength } from '../lib/library.js';
import { yarg } from '../lib/yarg.js';
import { settings } from '../lib/settings.js';
import { openModal } from '../lib/modal.js';
import InstIcon from '../components/InstIcon.vue';

const INST = Object.fromEntries(INSTRUMENTS.map((i) => [i.key, i]));
const PRO_OF = { guitar: 'proGuitar', bass: 'proBass', drums: 'proDrums', keys: 'proKeys', vocals: 'harmonies' };
const FILTERS = [
  ['all', 'All'], ['tab', 'Has tab'], ['notab', 'Needs a tab'], ['pro', 'Pro parts'], ['harmonies', 'Harmonies'], ['keys', 'Keys'], ['played', 'Played'], ['unplayed', 'Never played'],
];
const SORTS = [['artist', 'Artist'], ['title', 'Title'], ['added', 'Recently added'], ['played', 'Most played'], ['year', 'Year'], ['length', 'Length']];

const q = ref('');
const searchEl = ref(null);
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const hay = computed(() => new Map(library.songs.map((s) => [s.id, norm(`${s.name} ${s.artist} ${s.album} ${s.genre} ${s.year} ${s.charter}`)])));

const keep = {
  all: () => true,
  tab: (s) => !!s.tab,
  notab: (s) => !s.tab,
  pro: (s) => ['proGuitar', 'proBass', 'proDrums', 'proKeys'].some((k) => s.parts[k] != null),
  harmonies: (s) => s.parts.harmonies != null,
  keys: (s) => s.parts.keys != null || s.parts.proKeys != null,
  played: (s) => s.plays > 0,
  unplayed: (s) => !s.plays,
};
const by = {
  artist: null, // the server's order
  title: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  added: (a, b) => b.mtime - a.mtime,
  played: (a, b) => b.plays - a.plays || b.score - a.score,
  year: (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0),
  length: (a, b) => b.length - a.length,
};
const results = computed(() => {
  const terms = norm(q.value).split(/\s+/).filter(Boolean);
  const f = keep[settings.libFilter] || keep.all;
  let list = library.songs.filter((s) => f(s) && terms.every((t) => hay.value.get(s.id).includes(t)));
  const cmp = by[settings.libSort];
  if (cmp) list = [...list].sort(cmp);
  return list;
});
const counts = computed(() => Object.fromEntries(FILTERS.map(([k]) => [k, library.songs.filter(keep[k]).length])));

// letter headings when sorted by name
const letter = (s) => {
  const c = norm(settings.libSort === 'title' ? s.name : s.artist.replace(/^the\s+/i, '')).charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};
const grouped = computed(() => ['artist', 'title'].includes(settings.libSort));

// render in pages as you scroll
const PAGE = 120;
const limit = ref(PAGE);
const shown = computed(() => results.value.slice(0, limit.value));
const scroller = ref(null), more = ref(null);
let io = null;
watch([q, () => settings.libFilter, () => settings.libSort], () => { limit.value = PAGE; scroller.value?.scrollTo({ top: 0 }); });

const broken = reactive(new Set()); // songs without album art
const isNow = (s) => yarg.song && yarg.song.name === s.name && yarg.song.artist === s.artist;
const open = (s) => openModal('song', { id: s.id, preview: s });
const tierTitle = (s, k) => `${INST[k].label}: ${TIER[s.parts[k]] ?? '?'}${s.parts[PRO_OF[k]] != null ? ` · ${INST[PRO_OF[k]].label} too` : ''}`;
const starStr = (n) => (n >= 6 ? '★★★★★' : '★'.repeat(Math.max(0, n)) + '☆'.repeat(Math.max(0, 5 - n)));
const hue = (s) => [...(s.artist || s.name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

function onKey(e) {
  if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'f')) && document.activeElement !== searchEl.value) { e.preventDefault(); searchEl.value?.focus(); }
}
onMounted(() => {
  loadLibrary();
  io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting) && limit.value < results.value.length) limit.value += PAGE; }, { root: scroller.value, rootMargin: '600px' });
  if (more.value) io.observe(more.value);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => { io?.disconnect(); window.removeEventListener('keydown', onKey); });
// the library changed on the server (rescan, a tab added): fetch it again
watch(() => library.version, () => loadLibrary());
</script>

<template>
  <div class="lib">
    <div class="bar">
      <label class="search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
        <input ref="searchEl" v-model="q" type="search" placeholder="Search songs, artists, albums, genres…" autocomplete="off" spellcheck="false" />
        <button v-if="q" class="clear" aria-label="Clear" @click="q = ''; searchEl.focus()">✕</button>
      </label>
      <select v-model="settings.libSort" class="sort" aria-label="Sort">
        <option v-for="[k, l] in SORTS" :key="k" :value="k">{{ l }}</option>
      </select>
      <button class="icon" :class="{ spin: library.scanning }" title="Look through YARG's song folders again" @click="rescanLibrary">
        <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v3h3M4 13a8 8 0 0 0 14.6 4.5M20 20v-3h-3" /></svg>
      </button>
    </div>

    <div class="chips">
      <button v-for="[k, l] in FILTERS" :key="k" class="chip" :class="{ on: settings.libFilter === k }" @click="settings.libFilter = k">
        {{ l }} <small>{{ counts[k] }}</small>
      </button>
    </div>

    <div ref="scroller" class="list">
      <div v-if="library.error && !library.songs.length" class="empty">
        <svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
        <p><b>No songs found.</b> {{ library.error }}</p>
        <p class="small">yargDash reads the song folders set in YARG (<i>Settings → Songs</i>). If YARG keeps its data somewhere unusual, set it in Settings → YARG.</p>
      </div>
      <div v-else-if="!library.songs.length" class="empty"><p>{{ library.loading || library.scanning ? 'Reading YARG’s library…' : 'No songs in YARG’s song folders yet.' }}</p></div>
      <div v-else-if="!results.length" class="empty"><p>Nothing matches “{{ q }}”.</p></div>

      <template v-for="(s, i) in shown" :key="s.id">
        <div v-if="grouped && (i === 0 || letter(s) !== letter(shown[i - 1]))" class="letter">{{ letter(s) }}</div>
        <button class="row" :class="{ now: isNow(s) }" @click="open(s)">
          <div class="art" :style="{ '--h': hue(s) }">
            <img v-if="!broken.has(s.id)" :src="artUrl(s)" loading="lazy" alt="" @error="broken.add(s.id)" />
            <span v-else>{{ (s.name || '?').charAt(0) }}</span>
          </div>
          <div class="main">
            <div class="t"><span class="nm">{{ s.name }}</span><span v-if="isNow(s)" class="live">Playing</span></div>
            <div class="a">{{ s.artist }}<template v-if="s.album"> · {{ s.album }}</template><template v-if="s.year"> · {{ s.year }}</template></div>
          </div>
          <div class="parts">
            <span v-for="k in ROW_PARTS" :key="k" class="p" :class="{ off: s.parts[k] == null && s.parts[PRO_OF[k]] == null, pro: s.parts[PRO_OF[k]] != null }"
              :style="{ '--c': INST[k].color }" :title="s.parts[k] != null ? tierTitle(s, k) : `No ${INST[k].label.toLowerCase()}`">
              <InstIcon :name="INST[k].icon" />
            </span>
          </div>
          <div class="tab">
            <span v-if="s.tab === 'gp'" class="badge gp" title="Has a Guitar Pro tab">TAB</span>
            <span v-else-if="s.tab === 'pro'" class="badge pro" title="The chart has Pro Guitar/Bass: a tab comes with it">PRO</span>
          </div>
          <div class="best">
            <template v-if="s.plays"><span class="stars">{{ starStr(s.stars) }}</span><small>{{ s.plays }} play{{ s.plays === 1 ? '' : 's' }}</small></template>
          </div>
          <div class="len">{{ fmtLength(s.length) }}</div>
        </button>
      </template>
      <div ref="more" class="more" />
      <p v-if="results.length" class="foot">{{ results.length }} of {{ library.songs.length }} songs<template v-if="library.folders.length"> · {{ library.folders.join(', ') }}</template></p>
    </div>
  </div>
</template>

<style scoped>
.lib { height: 100%; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.bar { display: flex; gap: 8px; align-items: center; }
.search { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 12px; border-radius: 14px; background: var(--panel); border: 1px solid var(--line); transition: border-color .15s, box-shadow .15s; }
.search:focus-within { border-color: #b48cff; box-shadow: 0 0 0 3px #b48cff22; }
.search svg { width: 18px; height: 18px; fill: none; stroke: var(--muted); stroke-width: 2.2; stroke-linecap: round; flex: none; }
.search input { flex: 1; min-width: 0; height: 100%; background: transparent; border: 0; outline: 0; color: var(--text); font: inherit; font-size: 15px; }
.search input::-webkit-search-cancel-button { display: none; }
.clear { border: 0; background: #ffffff14; color: var(--muted); width: 24px; height: 24px; border-radius: 12px; font-size: 11px; padding: 0; }
.sort { height: 44px; border-radius: 14px; background: var(--panel); border: 1px solid var(--line); color: var(--text); font: inherit; font-weight: 600; padding: 0 10px; }
.icon { width: 44px; height: 44px; border-radius: 14px; background: var(--panel); border: 1px solid var(--line); color: var(--text); display: grid; place-items: center; padding: 0; }
.icon svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.icon.spin svg { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; flex: none; }
.chip { flex: none; height: 32px; padding: 0 12px; border-radius: 16px; background: var(--panel); border: 1px solid var(--line); color: var(--muted); font-weight: 600; font-size: 13px; white-space: nowrap; }
.chip small { margin-left: 4px; font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
.chip.on { background: #b48cff1f; border-color: #b48cff; color: #e2d4ff; }

.list { flex: 1; min-height: 0; overflow-y: auto; border-radius: 16px; background: var(--panel); border: 1px solid var(--line); padding: 6px; }
.letter { position: sticky; top: -6px; z-index: 1; margin: 0 -6px; padding: 10px 16px 6px; font-size: 12px; font-weight: 800; letter-spacing: .14em; color: #b48cff; background: linear-gradient(var(--panel) 70%, #14171c00); }
.row { width: 100%; display: grid; grid-template-columns: 48px minmax(0, 1fr) auto 52px 110px 48px; align-items: center; gap: 14px; padding: 7px 10px; border: 0; border-radius: 12px; background: transparent; color: var(--text); text-align: left; }
.row:hover { background: #ffffff08; }
.row:active { transform: none; background: #ffffff10; }
.row.now { background: linear-gradient(90deg, #b48cff1c, transparent 60%); }
.art { width: 48px; height: 48px; border-radius: 9px; overflow: hidden; background: linear-gradient(135deg, hsl(var(--h) 45% 32%), hsl(calc(var(--h) + 40) 40% 18%)); display: grid; place-items: center; box-shadow: 0 2px 8px #0006; }
.art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.art span { font-size: 20px; font-weight: 800; color: #ffffffc0; }
.main { min-width: 0; }
.t { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; }
.nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.live { flex: none; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; padding: 2px 6px; border-radius: 5px; background: #10291c; color: var(--ok); }
.a { margin-top: 2px; font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.parts { display: flex; gap: 4px; }
.p { position: relative; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; font-size: 16px; color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); }
.p.off { color: #ffffff24; background: transparent; }
.p.pro::after { content: ''; position: absolute; top: 3px; right: 3px; width: 5px; height: 5px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 1.5px var(--panel); }
.badge { display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: .08em; padding: 3px 7px; border-radius: 6px; }
.badge.gp { background: #10291c; color: var(--ok); }
.badge.pro { background: #0f2a2a; color: var(--accent); }
.best { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
.stars { color: var(--solo); font-size: 12px; letter-spacing: 1px; }
.best small { color: var(--muted); font-size: 11px; }
.len { text-align: right; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.more { height: 1px; }
.foot { text-align: center; color: var(--muted); font-size: 12px; margin: 10px 0 6px; }
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 60px 20px; color: var(--muted); text-align: center; }
.empty svg { width: 40px; height: 40px; fill: none; stroke: #b48cff; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; opacity: .7; }
.empty p { margin: 0; } .empty .small { font-size: 13px; max-width: 460px; }

@media (max-width: 860px) {
  .row { grid-template-columns: 48px minmax(0, 1fr) auto 44px; }
  .best, .len { display: none; }
}
@media (max-width: 620px) {
  .row { grid-template-columns: 44px minmax(0, 1fr) auto; gap: 10px; padding: 6px; }
  .art { width: 44px; height: 44px; }
  .parts { display: none; }
  .sort { max-width: 120px; }
}
</style>
