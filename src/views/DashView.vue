<script setup>
// The dashboard: what YARG is playing, where we are in it (time, section, tempo, beat), the lyrics (any vocal part,
// with a pitch guide), Guitar Pro / Pro Guitar tabs, every part's note lanes, a click for the drummer, and scores.
// Performer pages without controls (QR button): #stage[/harm1|harm2|harm3], #tab[/<track>], #lanes, #keys[/<track>], #click.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import LyricsPanel from '../components/LyricsPanel.vue';
import PitchGuide from '../components/PitchGuide.vue';
import ClickPanel from '../components/ClickPanel.vue';
import TabPanel from '../components/TabPanel.vue';
import LanesPanel from '../components/LanesPanel.vue';
import KeysPanel from '../components/KeysPanel.vue';
import SegPick from '../components/SegPick.vue';
import StartYarg from '../components/StartYarg.vue';
import PracticeBar from '../components/PracticeBar.vue';
import { practice } from '../lib/practice.js';
import { conn } from '../lib/conn.js';
import { yarg, songTime, synced, fmtTime, partKeys, partKey, PART_LABELS, sectionIndexAt, STAR_LABEL, shownSong, confirmMenu, tabTrackId, keysTracks, keysTrackId, uploadTab, findTab, setTabOffset, removeTab, setTabTuning, TUNINGS, tuningName, tuningNotes } from '../lib/yarg.js';
import { settings } from '../lib/settings.js';
import { route, go } from '../lib/router.js';
import { openModal } from '../lib/modal.js';
import { fitRow } from '../lib/fit.js';

const stage = computed(() => route.artist);
// practice has no Lanes or Click: those fall back to the tab (performer pages keep the view in their link)
const PRACTICE_HIDDEN = ['lanes', 'click'];
const mode = computed(() => route.mode || (yarg.song?.practice && PRACTICE_HIDDEN.includes(settings.mode) ? 'tab' : settings.mode));
const part = computed(() => partKey(route.part));
const parts = computed(() => partKeys());
const hasNotes = computed(() => (yarg.lyrics?.parts?.[part.value]?.notes || []).length > 0);
function pickPart(k) { if (route.part) location.hash = `#stage${k === 'vocals' ? '' : `/${k}`}`; else settings.vocalPart = k; }

const now = ref(null);
let timer = 0;
onMounted(() => { const up = () => { now.value = songTime(); }; up(); timer = setInterval(up, 250); });
onBeforeUnmount(() => clearInterval(timer));

const cur = computed(() => shownSong());        // the song or the menu music, when there are lyrics to show
const inMenu = computed(() => !yarg.song && !!yarg.menuSong);
const menuFollow = computed(() => inMenu.value && yarg.clock.menu);
const length = computed(() => cur.value?.length || 0);
const progress = computed(() => (now.value != null && isFinite(now.value) && length.value ? Math.min(1, Math.max(0, now.value / length.value)) : 0));
const sections = computed(() => yarg.lyrics?.sections || []);
const secIdx = computed(() => sectionIndexAt(now.value));
const curSec = computed(() => sections.value[secIdx.value]?.name || '');
const nextSec = computed(() => sections.value[secIdx.value + 1] || null);

const status = computed(() => {
  const c = yarg.clock;
  if (yarg.song?.practice) return c.state === 'run' ? { cls: 'ok', text: 'Practice' } : { cls: 'warn', text: 'Practice · paused' };
  if (!yarg.song) {
    if (menuFollow.value) return { cls: 'ok', text: 'Menu · approx.' };
    return { cls: 'idle', text: yarg.detected ? (yarg.menuSong ? 'Menu' : 'Waiting for a song') : 'YARG not running' };
  }
  if (c.state === 'pause') return { cls: 'warn', text: 'Paused' };
  if (c.state === 'wait') return { cls: 'warn', text: 'Starting…' };
  if (c.state === 'run') return { cls: 'ok', text: 'Live' };
  if (c.stream && c.scene === 'practice') return { cls: 'idle', text: 'Practice: not synced' };
  return { cls: 'idle', text: 'Not synced' };
});
const bpm = computed(() => (synced() && yarg.clock.bpm ? yarg.clock.bpm : null));
const showStreamHint = computed(() => yarg.song && !yarg.song.practice && !yarg.clock.stream && !stage.value);
// this page plays the practice audio: it gets the transport
const practising = computed(() => !!practice.id && !!yarg.song?.practice && !stage.value);


// ---------- scores ----------
const stars = (n) => (n >= 6 ? '★★★★★' : '★'.repeat(Math.max(0, n)) + '☆'.repeat(Math.max(0, 5 - n)));
const fmtScore = (n) => (n || 0).toLocaleString();
const last = computed(() => yarg.results?.last || null);
const best = computed(() => yarg.results?.best || null);
const ago = (ms) => {
  if (!ms) return '';
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(ms).toLocaleDateString();
};

// the controls row: its pickers turn into dropdowns when they'd wrap it (the track picker first, then the views)
const VIEWS = [{ value: 'lyrics', label: 'Lyrics' }, { value: 'tab', label: 'Tab' }, { value: 'lanes', label: 'Lanes' }, { value: 'keys', label: 'Keys' }, { value: 'click', label: 'Click' }];
const views = computed(() => (yarg.song?.practice ? VIEWS.filter((v) => !PRACTICE_HIDDEN.includes(v.value)) : VIEWS));
const row = ref(null), trackPick = ref(null), viewPick = ref(null);
const compact = fitRow(row, () => [['track', trackPick.value], ['view', viewPick.value]]);
const opts = (ts) => ts.map((t) => ({ value: t.id, label: t.name, title: `${t.count} notes` }));

const zoom = (d) => {
  const key = mode.value === 'tab' ? 'tabScale' : 'lyricsScale';
  settings[key] = Math.min(2.2, Math.max(0.6, Math.round(((settings[key] || 1) + d) * 10) / 10));
};

// ---------- tabs ----------
const tabTracks = computed(() => (yarg.tabs?.tracks || []).filter((t) => t.kind !== 'keys'));
const tabId = computed(() => tabTrackId(route.tabTrack));
const tabTrack = computed(() => tabTracks.value.find((t) => t.id === tabId.value) || null);
function pickTab(t) {
  if (route.tabTrack) { location.hash = `#tab/${t.id}`; return; }
  settings.tabTrack = t.id; settings.tabKind = t.kind;
}
// keys: the keyboard part this device shows
const keyTracks = computed(() => keysTracks());
const keysId = computed(() => keysTrackId(route.tabTrack));
const keysTrack = computed(() => keyTracks.value.find((t) => t.id === keysId.value) || null);
function pickKeys(t) {
  if (route.tabTrack) { location.hash = `#keys/${t.id}`; return; }
  settings.keysTrack = t.id;
}
const keysSpeed = (d) => { settings.keysSpeed = Math.round(Math.min(3, Math.max(0.4, (settings.keysSpeed || 1) + d)) * 10) / 10; };
// the Guitar Pro track whose placement the bar offset controls (tab or keys)
const gpShown = computed(() => (mode.value === 'tab' ? tabTrack.value : mode.value === 'keys' ? keysTrack.value : null)?.source === 'gp');
const fileInput = ref(null);
const tabMsg = ref('');
async function onTabFile(e) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  tabMsg.value = `Adding ${f.name}…`;
  try { await uploadTab(f); tabMsg.value = ''; } catch (err) { tabMsg.value = err.message; }
}
async function onFindTab() {
  tabMsg.value = '';
  try { await findTab(); tabMsg.value = 'Opened Ultimate Guitar in the browser. Download a Guitar Pro file there and it’s added to this song by itself.'; } catch (err) { tabMsg.value = err.message; }
}
// Lanes: which parts this device shows, and note speed
const lanesRef = ref(null);
const laneParts = computed(() => lanesRef.value?.available || []);
const LANE_LABEL = { guitar: 'Guitar', rhythm: 'Rhythm', bass: 'Bass', drums: 'Drums', keys: 'Keys' };
function toggleLane(k) {
  const h = settings.lanesHidden;
  settings.lanesHidden = h.includes(k) ? h.filter((x) => x !== k) : [...h, k];
}
const laneSpeed = (d) => { settings.lanesSpeed = Math.round(Math.min(3, Math.max(0.5, (settings.lanesSpeed || 1) + d)) * 10) / 10; };
const shiftTab = (d) => setTabOffset((yarg.tabs?.offset || 0) + d);
const tabBeat = computed(() => yarg.tabs?.beat || 0.25); // one beat of the song, in tab bars
// tab bars, with the fraction as ¼ ½ ¾ ⅓ ⅔ when it's one of those: 1.25 → "1¼", -0.5 → "−½"
const FRAC = { 25: '¼', 50: '½', 75: '¾', 33: '⅓', 67: '⅔' };
function fmtBars(x) {
  const n = Math.abs(x || 0), w = Math.floor(n + 1e-6), f = Math.round((n - w) * 100);
  const frac = f === 0 ? '' : FRAC[f] ?? `.${String(f).padStart(2, '0')}`;
  return `${x < -1e-6 ? '−' : ''}${w || !frac || frac[0] === '.' ? w : ''}${frac}`;
}
const tuningOptions = computed(() => TUNINGS[tabTrack.value?.strings] || []);
const tuningValue = computed(() => (tabTrack.value?.tuningFrom === 'set' ? tabTrack.value.tuning.join(',') : ''));
function pickTuning(v) { if (tabTrack.value) setTabTuning(tabTrack.value.id, v ? v.split(',').map(Number) : null); }
function dropTab() { if (confirm(`Remove ${yarg.tabs?.file} from this song?`)) removeTab(); }
function share() {
  if (mode.value === 'tab' && tabTrack.value) openModal('qr', { hash: `#tab/${tabTrack.value.id}`, title: `Tab · ${tabTrack.value.name}`, what: `Opens the ${tabTrack.value.kind} tab for whatever YARG is playing, in time, with no other controls.` });
  else if (mode.value === 'keys' && keysTrack.value) openModal('qr', { hash: `#keys/${keysTrack.value.id}`, title: `Keys · ${keysTrack.value.name}`, what: 'The keyboard part for whatever YARG is playing, falling onto piano keys in time, with no other controls.' });
  else if (mode.value === 'lanes') openModal('qr', { hash: '#lanes', title: 'Lanes', what: 'Every part\'s notes (guitar, bass, drums, keys) for whatever YARG is playing, with the lyrics: for a screen facing the audience.' });
  else if (mode.value === 'click') openModal('qr', { hash: '#click', title: 'Click', what: 'A big beat counter for the drummer, following the song YARG is playing.' });
  else {
    const p = part.value && part.value !== 'vocals' ? `/${part.value}` : '';
    openModal('qr', { hash: `#stage${p}`, title: `Lyrics${p ? ` · ${PART_LABELS[part.value]}` : ''}`, what: `Opens the live ${p ? PART_LABELS[part.value].toLowerCase() : 'lyrics'} for whatever YARG is playing, with no other controls.` });
  }
}
</script>

<template>
  <div class="yarg" :class="{ stage }">
    <div class="top">
      <div class="np">
        <div class="lbl">
          <span class="st" :class="status.cls">{{ status.text }}</span>
          <span v-if="bpm" class="bpm"><i :key="yarg.beat.n" class="beat" :class="{ bar: yarg.beat.k === 0 }" />{{ bpm }} BPM</span>
          <span v-if="best && yarg.song" class="best" :title="`${best.plays} play${best.plays === 1 ? '' : 's'}`">Best <span class="stars">{{ stars(best.stars) }}</span> {{ fmtScore(best.score) }}</span>
        </div>
        <template v-if="yarg.song">
          <div class="title">{{ yarg.song.name }}</div>
          <div class="sub">{{ [yarg.song.artist, yarg.song.album, yarg.song.year].filter(Boolean).join(' · ') }}<template v-if="yarg.song.practice && !practising"> — practising on the YARG computer</template></div>
        </template>
        <template v-else-if="yarg.menuSong">
          <div class="title menu"><svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>{{ yarg.menuSong.name }}</div>
          <div class="sub">{{ [yarg.menuSong.artist, yarg.menuSong.album, yarg.menuSong.year].filter(Boolean).join(' · ') }} — playing in YARG's menu</div>
          <div v-if="yarg.menuSong.start && !stage" class="follow">
            <template v-if="menuFollow">Following the menu music from when it started. Paused or skipped it? <button @click="confirmMenu(false)">Stop following</button></template>
            <template v-else>Lyrics aren't following: it may be a preview. Started from the top? <button @click="confirmMenu(true)">Follow it</button></template>
          </div>
        </template>
        <template v-else>
          <div class="title">Nothing playing</div>
          <div class="sub">Start a song in YARG and its lyrics appear here.</div>
        </template>
        <div v-if="cur && synced() && !practising" class="prog">
          <span class="tm">{{ fmtTime(now) }}</span>
          <div class="bar"><i :style="{ transform: `scaleX(${progress})` }" /></div>
          <span class="tm">{{ fmtTime(length) }}</span>
        </div>
      </div>
      <div v-if="cur && (curSec || nextSec)" class="secbox">
        <div class="lbl">Section</div>
        <div class="cur">{{ curSec || '—' }}</div>
        <div v-if="nextSec && now != null && isFinite(now)" class="nx">Next: {{ nextSec.name }} <b>in {{ Math.max(0, Math.ceil(nextSec.t - now)) }}s</b></div>
      </div>
      <div class="tools">
        <template v-if="mode === 'lyrics' || mode === 'tab'">
          <button aria-label="Smaller text" @click="zoom(-0.1)">A−</button>
          <button aria-label="Larger text" @click="zoom(0.1)">A+</button>
        </template>
        <template v-if="mode === 'lanes'">
          <button aria-label="Slower notes" title="Slower notes" @click="laneSpeed(-0.1)">🐢</button>
          <button aria-label="Faster notes" title="Faster notes" @click="laneSpeed(0.1)">🐇</button>
        </template>
        <template v-if="mode === 'keys'">
          <button aria-label="Slower notes" title="Slower notes" @click="keysSpeed(-0.1)">🐢</button>
          <button aria-label="Faster notes" title="Faster notes" @click="keysSpeed(0.1)">🐇</button>
        </template>
        <button v-if="!stage" class="qr" title="Open on a performer's phone" @click="share">
          <svg viewBox="0 0 24 24"><path d="M3 3h8v8H3zm2 2v4h4V5zm8-2h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zm11-2h2v2h-2zm-3 0h2v4h-2zm3 3h5v2h-5zm3-3h2v2h-2zm-6 5h2v3h-2zm3 1h2v2h-2zm3 0h2v2h-2z" /></svg>
        </button>
      </div>
    </div>

    <PracticeBar v-if="practising" />

    <!-- mode / part / pitch / tab controls -->
    <div v-if="cur || !stage" ref="row" class="bar2">
      <SegPick v-if="!route.mode" ref="viewPick" :options="views" :model-value="mode" :compact="compact.view" label="View" @update:model-value="settings.mode = $event" />
      <template v-if="mode === 'lyrics' && cur">
        <SegPick v-if="parts.length > 1" ref="trackPick" :options="parts.map((k) => ({ value: k, label: PART_LABELS[k] }))" :model-value="part" :compact="compact.track" label="Part" @update:model-value="pickPart" />
        <button v-if="hasNotes" class="chip" :class="{ on: settings.pitchGuide }" @click="settings.pitchGuide = !settings.pitchGuide">Pitch</button>
      </template>
      <div v-if="mode === 'lanes' && cur && !stage && laneParts.length > 1" class="seg parts" title="Parts shown on this device">
        <button v-for="k in laneParts" :key="k" :class="{ on: !settings.lanesHidden.includes(k) }" @click="toggleLane(k)">{{ LANE_LABEL[k] }}</button>
      </div>
      <template v-if="mode === 'keys' && cur">
        <SegPick v-if="keyTracks.length > 1" ref="trackPick" :options="opts(keyTracks)" :model-value="keysId" :compact="compact.track" label="Part" @update:model-value="(id) => pickKeys(keyTracks.find((t) => t.id === id))" />
        <button v-if="keysTrack" class="chip" :class="{ on: settings.keysNames }" title="Note names on the notes and keys" @click="settings.keysNames = !settings.keysNames">Names</button>
      </template>
      <template v-if="(mode === 'tab' || mode === 'keys') && cur">
        <template v-if="mode === 'tab'">
          <SegPick v-if="tabTracks.length > 1" ref="trackPick" :options="opts(tabTracks)" :model-value="tabId" :compact="compact.track" label="Track" @update:model-value="(id) => pickTab(tabTracks.find((t) => t.id === id))" />
          <span v-if="stage && tabTrack" class="tuning ro">{{ tuningName(tabTrack.tuning) }} · {{ tuningNotes(tabTrack.tuning) }}</span>
        </template>
        <template v-if="!stage">
          <span v-if="yarg.tabs?.file && gpShown" class="offset" title="Which bar of the song the tab's first bar lines up with: « » move a bar, ‹ › a beat">
            Bar offset
            <button aria-label="A bar earlier" title="A bar earlier" @click="shiftTab(-1)">«</button><button aria-label="A beat earlier" title="A beat earlier" @click="shiftTab(-tabBeat)">‹</button><b>{{ fmtBars(yarg.tabs.offset) }}</b><button aria-label="A beat later" title="A beat later" @click="shiftTab(tabBeat)">›</button><button aria-label="A bar later" title="A bar later" @click="shiftTab(1)">»</button>
            <button class="autob" :class="{ on: yarg.tabs.auto }" @click="setTabOffset(null)">Auto{{ yarg.tabs.auto ? '' : ` (${fmtBars(yarg.tabs.autoOffset)})` }}</button>
            <span v-if="yarg.tabs.match != null" class="match-pct" :class="{ low: yarg.tabs.match < 0.4 }" title="How many of the tab's notes land on the chart's notes">match {{ Math.round(yarg.tabs.match * 100) }}%</span>
            <span v-if="yarg.tabs.changes?.length" class="ratio" :title="'Sections placed differently from the tab to follow the recording'">{{ yarg.tabs.changes.map((c) => `${c.name} ${c.shift === null ? 'left out' : `${c.shift > 0 ? '+' : ''}${c.shift} bars`}`).join(' · ') }}</span>
            <span v-if="yarg.tabs.ratio && yarg.tabs.ratio !== 1" class="ratio" title="The tab counts bars differently from the chart">{{ yarg.tabs.ratio < 1 ? `${Math.round(1 / yarg.tabs.ratio)} tab bars = 1 song bar` : `1 tab bar = ${yarg.tabs.ratio} song bars` }}</span>
          </span>
          <label v-if="mode === 'tab' && tabTrack" class="tuning" :class="{ assumed: tabTrack.tuningFrom === 'assumed' }"
            :title="tabTrack.tuningFrom === 'assumed' ? 'The chart doesn\'t say how this part is tuned: pick the tuning (saved for this song)' : `Tuning: ${tuningNotes(tabTrack.tuning)}`">
            Tuning
            <select :value="tuningValue" @change="pickTuning($event.target.value)">
              <option value="">{{ tabTrack.tuningFrom === 'assumed' ? 'Standard (assumed)' : `${tuningName(tabTrack.tuning)} (${tabTrack.source === 'gp' ? 'from file' : 'from chart'})` }}</option>
              <option v-for="[n, t] in tuningOptions" :key="n" :value="t.join(',')">{{ n }} — {{ tuningNotes(t) }}</option>
            </select>
          </label>
          <template v-if="yarg.local">
            <button v-if="yarg.tabs?.file && (mode === 'tab' || gpShown)" class="chip" :title="`Replace ${yarg.tabs.file}`" @click="fileInput.click()">Replace file</button>
            <button v-if="yarg.tabs?.file && (mode === 'tab' || gpShown)" class="chip" title="Remove the Guitar Pro file from this song" @click="dropTab">✕</button>
            <!-- the chart has its own parts (Pro Guitar/Bass/Keys) but no Guitar Pro file yet: one can still be added -->
            <template v-if="!yarg.tabs?.file && (mode === 'tab' ? tabTrack : keysTrack)">
              <button class="chip" title="Search Ultimate Guitar for this song's Guitar Pro tabs; a file you download is added by itself" @click="onFindTab">Find tab</button>
              <button class="chip" title="Add a Guitar Pro file to this song, next to the chart's own parts" @click="fileInput.click()">+ Guitar Pro file</button>
            </template>
            <input ref="fileInput" type="file" accept=".gp,.gpx,.gp5,.gp4,.gp3" hidden @change="onTabFile" />
          </template>
        </template>
      </template>
    </div>

    <div v-if="tabMsg || ((mode === 'tab' || mode === 'keys') && yarg.tabs?.error)" class="hint">{{ tabMsg || yarg.tabs.error }}</div>
    <div v-if="showStreamHint" class="hint">
      <template v-if="yarg.streamBlocked && conn.platform === 'darwin'">
        Lyrics aren't following the song: YARG is trying to send its data stream, but macOS is blocking it. Restart YARG with yargDash's fix.
        <StartYarg compact class="dashstart" />
      </template>
      <template v-else>Lyrics aren't following the song. Turn on <b>Settings → All Settings → Experimental → Enable UDP Data Stream</b> in YARG.</template>
    </div>

    <div class="sheet" :class="{ flat: mode === 'click' }">
      <div v-if="inMenu && last && !stage && cur" class="lastline">
        Last song: <b>{{ last.song }}</b> <span class="stars" :class="{ gold: last.stars >= 6 }">{{ stars(last.stars) }}</span> {{ fmtScore(last.score) }}
        <span class="m">· {{ ago(last.date) }}</span>
      </div>
      <template v-if="cur && yarg.lyrics">
        <ClickPanel v-if="mode === 'click'" />
        <LanesPanel v-else-if="mode === 'lanes'" ref="lanesRef" />
        <template v-else-if="mode === 'keys'">
          <KeysPanel v-if="keysTrack" :key="keysTrack.id" :track-id="keysTrack.id" />
          <div v-else class="empty">
            <p>No keyboard part for this song.</p>
            <p class="small">Songs with Pro Keys in the chart have one automatically. So does a Guitar Pro file with a piano, organ or synth part{{ stage || !yarg.local ? ' (added on the YARG computer)' : '' }}: it lines up with the song by itself.</p>
            <div v-if="!stage && yarg.local" class="find">
              <button class="chip on" title="Search Ultimate Guitar for this song's Guitar Pro tabs; a file you download is added by itself" @click="onFindTab">Find tab</button>
              <button class="chip" @click="fileInput.click()">+ Guitar Pro file</button>
            </div>
          </div>
        </template>
        <template v-else-if="mode === 'tab'">
          <TabPanel v-if="tabTrack" :key="tabTrack.id" :track-id="tabTrack.id" />
          <div v-else class="empty">
            <p>No tab for this song.</p>
            <p class="small">Songs with Pro Guitar/Bass in the chart have one automatically. For others, add a Guitar Pro file (.gp, .gpx, .gp5, .gp4, .gp3){{ stage || !yarg.local ? ' on the YARG computer' : '' }}: it lines up with the song's bars by itself.</p>
            <div v-if="!stage && yarg.local" class="find">
              <button class="chip on" title="Search Ultimate Guitar for this song's Guitar Pro tabs; a file you download is added by itself" @click="onFindTab">Find tab</button>
              <button class="chip" @click="fileInput.click()">+ Guitar Pro file</button>
            </div>
          </div>
        </template>
        <template v-else>
          <PitchGuide v-if="settings.pitchGuide && hasNotes && part" :part="part" />
          <LyricsPanel v-if="part || yarg.lyrics.error" :big="stage" :part="part || 'vocals'" />
          <div v-else class="empty"><p>This song has no vocals.</p></div>
        </template>
      </template>
      <div v-else class="empty">
        <div v-if="last && !stage" class="result">
          <div class="rlbl">Last song · {{ ago(last.date) }}</div>
          <div class="rtitle">{{ last.song }} <span>— {{ last.artist }}</span></div>
          <div class="rband"><span class="stars big" :class="{ gold: last.stars >= 6 }">{{ stars(last.stars) }}</span><b>{{ fmtScore(last.score) }}</b>
            <small v-if="STAR_LABEL[last.stars]">{{ STAR_LABEL[last.stars] }}</small><small v-if="last.speed && last.speed !== 1">{{ Math.round(last.speed * 100) }}% speed</small></div>
          <table>
            <tr v-for="(p, i) in last.players" :key="i">
              <td>{{ p.name }}</td><td class="m">{{ p.instrument }} · {{ p.difficulty }}</td>
              <td class="stars" :class="{ gold: p.stars >= 6 }">{{ stars(p.stars) }}</td><td class="num">{{ p.percent != null ? `${Math.round(p.percent * 100)}%` : '' }}</td>
              <td class="num">{{ fmtScore(p.score) }}</td><td>{{ p.fc ? 'FC' : '' }}</td>
            </tr>
          </table>
        </div>
        <template v-else>
          <svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
          <p>{{ yarg.detected ? 'Waiting for YARG to start a song…' : 'YARG isn\'t running on this computer.' }}</p>
          <p v-if="!yarg.detected && yarg.local && !stage" class="small">Want to play along anyway? Pick a song in the <a href="#library" @click.prevent="go('library')">Library</a> and press <b>Practice</b>.</p>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.yarg { height: 100%; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.top { display: flex; gap: 10px; align-items: stretch; flex: none; }
.np { flex: 1; min-width: 0; padding: 12px 16px; border-radius: 16px; background: linear-gradient(135deg, #2a1f3a, #14171c 70%); border: 1px solid #3d2f55; }
.lbl { display: flex; align-items: center; gap: 10px; font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.st { padding: 2px 7px; border-radius: 6px; background: #ffffff10; }
.st.ok { background: #10291c; color: var(--ok); }
.st.warn { background: #33280c; color: var(--solo); }
.bpm { display: inline-flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }
.beat { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); animation: beat .35s ease-out forwards; }
.beat.bar { background: var(--solo); box-shadow: 0 0 10px var(--solo); }
@keyframes beat { from { opacity: 1; transform: scale(1.3); } to { opacity: .15; transform: scale(.9); } }
.best { margin-left: auto; letter-spacing: .04em; text-transform: none; font-size: 12px; white-space: nowrap; }
.stars { color: var(--solo); letter-spacing: 1px; }
.title { font-size: 24px; font-weight: 800; margin: 3px 0 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.title.menu { display: flex; align-items: center; gap: 8px; color: #d9ccff; }
.title.menu svg { flex: none; width: 20px; height: 20px; fill: none; stroke: #b48cff; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.sub { font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.prog { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.tm { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.prog .bar { flex: 1; height: 4px; border-radius: 2px; background: #ffffff14; overflow: hidden; }
.prog .bar i { display: block; height: 100%; background: #b48cff; transform-origin: left center; transition: transform .25s linear; }
.secbox { flex: none; width: 190px; padding: 12px 14px; border-radius: 16px; background: var(--panel); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 2px; }
.secbox .cur { font-size: 19px; font-weight: 800; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.secbox .nx { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.secbox .nx b { color: var(--text); font-variant-numeric: tabular-nums; }
.tools { flex: none; display: flex; flex-direction: column; gap: 6px; }
.tools button { flex: 1; min-height: 34px; width: 52px; padding: 0; border-radius: 10px; background: var(--btn); border: 1px solid var(--line); color: var(--text); font-weight: 800; display: grid; place-items: center; }
.tools svg { width: 20px; height: 20px; fill: currentColor; }

.bar2 { flex: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.seg { display: flex; gap: 2px; padding: 3px; border-radius: 11px; background: var(--panel); border: 1px solid var(--line); }
.seg button { height: 32px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-weight: 700; font-size: 13px; }
.seg.parts { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.seg.parts button { flex: none; white-space: nowrap; }
.seg button.on { background: var(--btn); color: var(--text); box-shadow: inset 0 -2px 0 #b48cff; }
.chip { height: 38px; padding: 0 12px; border-radius: 10px; background: var(--btn); border: 1px solid var(--line); color: var(--muted); font-weight: 700; font-size: 13px; }
.find { display: flex; gap: 8px; justify-content: center; }
.chip.on { color: var(--accent); border-color: var(--accent); }
.offset { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--muted); }
.offset b { min-width: 22px; text-align: center; color: var(--text); font-variant-numeric: tabular-nums; }
.offset button { height: 32px; min-width: 30px; padding: 0 8px; border-radius: 8px; background: var(--btn); border: 1px solid var(--line); color: var(--text); font-weight: 800; }
.offset .autob { color: var(--muted); font-weight: 700; font-size: 12px; }
.tuning { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
.tuning select { height: 34px; border-radius: 8px; background: var(--btn); border: 1px solid var(--line); color: var(--text); font: inherit; font-weight: 700; padding: 0 6px; max-width: 220px; }
.tuning.assumed select { border-color: var(--solo); color: var(--solo); }
.tuning.ro { font-weight: 700; color: var(--text); }
.match-pct, .ratio { font-size: 12px; margin-left: 4px; }
.match-pct { color: var(--ok); } .match-pct.low { color: var(--solo); }
.offset .autob.on { color: var(--accent); border-color: var(--accent); }
.empty .small { font-size: 13px; max-width: 460px; margin: 0; }

.follow { margin-top: 6px; font-size: 12px; color: var(--muted); }
.follow button { margin-left: 4px; height: 24px; padding: 0 8px; border-radius: 7px; background: var(--btn); border: 1px solid var(--line); color: var(--text); font-weight: 700; font-size: 12px; }
.lastline { flex: none; font-size: 13px; color: var(--muted); padding: 2px 2px 6px; border-bottom: 1px solid var(--line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lastline b { color: var(--text); }
.dashstart { margin-top: 8px; }
.hint { flex: none; background: #3a2a0c; border: 1px solid #6b4d12; color: #f5cf7a; padding: 8px 12px; border-radius: 12px; font-size: 13px; }
.sheet { flex: 1; min-height: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 10px 16px 4px; display: flex; flex-direction: column; gap: 8px; }
.sheet > :last-child { flex: 1; min-height: 0; }
.empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--muted); text-align: center; }
.empty > svg { width: 44px; height: 44px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; opacity: .6; }
.stage .sheet { padding: 10px 20px 4px; }

.result { width: min(100%, 640px); text-align: left; display: flex; flex-direction: column; gap: 6px; color: var(--text); }
.rlbl { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.rtitle { font-size: 20px; font-weight: 800; }
.rtitle span { color: var(--muted); font-weight: 600; font-size: 15px; }
.rband { display: flex; align-items: baseline; gap: 12px; }
.rband b { font-size: 26px; font-variant-numeric: tabular-nums; }
.rband small { color: var(--muted); }
.stars.big { font-size: 24px; }
.stars.gold, .result td.stars.gold { color: #ffd54a; text-shadow: 0 0 12px #ffd54a88; }
.result table { border-collapse: collapse; font-size: 14px; margin-top: 6px; }
.result td { padding: 6px 10px 6px 0; border-top: 1px solid var(--line); white-space: nowrap; }
.result td.m { color: var(--muted); }
.result td.num { text-align: right; font-variant-numeric: tabular-nums; }

@media (max-width: 720px) {
  .top { flex-wrap: wrap; }
  .np { flex-basis: calc(100% - 62px); }
  .secbox { order: 3; width: 100%; flex-direction: row; align-items: baseline; gap: 10px; padding: 8px 12px; }
  .secbox .lbl { display: none; }
  .secbox .cur { font-size: 16px; }
  .title { font-size: 20px; }
  .best { display: none; }
  .stage .np { padding: 8px 12px; }
  .stage .sub { display: none; }
  .stage .prog { margin-top: 4px; }
}
/* phone in landscape, performer page: one slim strip on top so the tab/lyrics get the height */
@media (max-height: 500px) {
  .stage { gap: 6px; }
  .stage .top { flex-wrap: nowrap; gap: 6px; }
  .stage .np { flex: 1; flex-basis: auto; display: flex; align-items: center; gap: 10px; padding: 5px 12px; border-radius: 12px; }
  .stage .np .lbl { flex: none; }
  .stage .best, .stage .sub { display: none; }
  .stage .title { font-size: 16px; margin: 0; min-width: 0; flex: 0 1 auto; }
  .stage .prog { flex: 1; min-width: 90px; margin-top: 0; }
  .stage .secbox { order: 0; width: auto; max-width: 34%; flex-direction: row; align-items: baseline; gap: 8px; padding: 5px 12px; border-radius: 12px; }
  .stage .secbox .lbl { display: none; }
  .stage .secbox .cur { font-size: 15px; }
  .stage .tools { flex-direction: row; gap: 4px; }
  .stage .tools button { min-height: 0; height: auto; width: 40px; border-radius: 8px; }
  .stage .bar2 { gap: 6px; flex-wrap: nowrap; }
  .stage .seg.parts { flex: 0 1 auto; min-width: 0; }
  .stage .tuning.ro { flex: none; font-size: 12px; }
  .stage .seg button { height: 26px; }
  .stage .sheet { padding: 4px 12px 2px; border-radius: 12px; }
}
</style>
