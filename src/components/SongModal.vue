<script setup>
// One song from the library: what's in it (instruments and difficulty, vocal parts, sections, tempo), its tab
// (the chart's Pro parts, or a Guitar Pro file and how well it lines up), and the band's best score.
import { ref, computed, watch, onMounted } from 'vue';
import Modal from './Modal.vue';
import InstIcon from './InstIcon.vue';
import { library, fetchSong, findSongTab, removeSongTab, uploadSongTab, artUrl, INSTRUMENTS, TIER, fmtLength } from '../lib/library.js';
import { yarg, tuningName, fmtTime } from '../lib/yarg.js';
import { closeModal } from '../lib/modal.js';

const props = defineProps({ id: { type: String, required: true }, preview: { type: Object, default: null } });

const song = ref(null), err = ref(''), busy = ref(''), msg = ref('');
const s = computed(() => song.value || props.preview || {});
const artOk = ref(true);

async function load() {
  try { song.value = await fetchSong(props.id); err.value = ''; } catch (e) { err.value = e.message; }
}
onMounted(load);
// a tab was added (e.g. downloaded after "Find tab") or removed: show it
watch(() => library.version, () => { if (!busy.value) load(); });

// ---------- instruments ----------
const LANE_OF = { guitar: 'guitar', rhythm: 'rhythm', bass: 'bass', drums: 'drums', keys: 'keys' };
const VOCAL_LABEL = { vocals: 'Lead', harm1: 'Harmony 1', harm2: 'Harmony 2', harm3: 'Harmony 3' };
const instruments = computed(() => {
  const parts = s.value.parts || {}, lanes = song.value?.chart?.lanes || {};
  return INSTRUMENTS.filter((i) => parts[i.key] != null || (LANE_OF[i.key] && lanes[LANE_OF[i.key]]))
    .map((i) => ({ ...i, tier: parts[i.key] ?? null, notes: LANE_OF[i.key] ? lanes[LANE_OF[i.key]]?.notes : null }));
});
const vocals = computed(() => Object.entries(song.value?.chart?.vocals || {}).map(([k, n]) => ({ key: k, label: VOCAL_LABEL[k] || k, phrases: n })));
const sections = computed(() => song.value?.chart?.sections || []);

// ---------- tab ----------
const tabs = computed(() => song.value?.tabs || null);
const gpTracks = computed(() => (tabs.value?.tracks || []).filter((t) => t.source === 'gp'));
const proTracks = computed(() => (tabs.value?.tracks || []).filter((t) => t.source === 'chart'));
const match = computed(() => tabs.value?.match);
const matchWord = computed(() => {
  const m = match.value;
  if (m == null) return { cls: 'mid', text: 'Can’t check: the chart has no guitar or bass notes to line it up with' };
  if (m >= 0.7) return { cls: 'good', text: 'Lines up well with the song' };
  if (m >= 0.45) return { cls: 'mid', text: 'Mostly lines up: nudge it with the bar offset while it plays if a part is off' };
  return { cls: 'bad', text: 'Doesn’t line up well: it may be a different version of the song, or not this song' };
});
const ratioText = computed(() => {
  const q = tabs.value?.ratio;
  if (!q || q === 1) return '';
  return q < 1 ? `${Math.round(1 / q)} tab bars = 1 song bar` : `1 tab bar = ${q} song bars`;
});

const fileInput = ref(null);
async function onFile(e) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  busy.value = 'upload'; msg.value = '';
  try { await uploadSongTab(props.id, f); await load(); msg.value = 'Added.'; } catch (x) { msg.value = x.message; }
  busy.value = '';
}
async function find() {
  busy.value = 'find'; msg.value = '';
  try { await findSongTab(props.id); msg.value = 'Opened Ultimate Guitar in the browser. Download a Guitar Pro file there and it’s added to this song by itself.'; } catch (x) { msg.value = x.message; }
  busy.value = '';
}
async function remove() {
  if (!confirm(`Remove the Guitar Pro file from “${s.value.name}”? It’s deleted from yargDash’s tabs folder.`)) return;
  busy.value = 'remove'; msg.value = '';
  try { await removeSongTab(props.id); await load(); } catch (x) { msg.value = x.message; }
  busy.value = '';
}

// ---------- scores ----------
const best = computed(() => song.value?.best || null);
const stars = (n) => (n >= 6 ? '★★★★★' : '★'.repeat(Math.max(0, n)) + '☆'.repeat(Math.max(0, 5 - n)));
const isNow = computed(() => yarg.song && yarg.song.name === s.value.name && yarg.song.artist === s.value.artist);
const facts = computed(() => [
  ['Album', s.value.album], ['Year', s.value.year], ['Genre', s.value.genre], ['Charter', s.value.charter],
  ['Length', fmtLength(s.value.length)], ['Tempo', song.value?.chart?.bpm ? `~${song.value.chart.bpm} BPM` : ''],
].filter(([, v]) => v));
</script>

<template>
  <Modal :title="s.name || 'Song'" :subtitle="s.artist || ''" width="760px" @close="closeModal">
    <div class="song">
      <div class="hero">
        <div class="art">
          <img v-if="artOk && s.id" :src="artUrl(s)" alt="" @error="artOk = false" />
          <svg v-else viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
        </div>
        <div class="info">
          <div v-if="isNow" class="live">Playing in YARG now</div>
          <dl>
            <template v-for="[k, v] in facts" :key="k"><dt>{{ k }}</dt><dd>{{ v }}</dd></template>
          </dl>
          <p v-if="song?.loading" class="quote">“{{ song.loading }}”</p>
        </div>
      </div>

      <p v-if="err" class="error">{{ err }}</p>

      <!-- instruments -->
      <section>
        <h3>Instruments</h3>
        <div class="insts">
          <div v-for="i in instruments" :key="i.key" class="inst" :style="{ '--c': i.color }">
            <span class="ic"><InstIcon :name="i.icon" /></span>
            <div class="il">
              <div class="nm">{{ i.label }}<span v-if="i.pro" class="pro">PRO</span></div>
              <div class="tier">
                <template v-if="i.tier != null">
                  <span class="pips"><i v-for="n in 6" :key="n" :class="{ on: n <= i.tier, devil: i.tier >= 6 }" /></span>{{ TIER[i.tier] }}
                </template>
                <template v-else>Charted</template>
                <span v-if="i.notes" class="cnt">{{ i.notes.toLocaleString() }} notes</span>
              </div>
            </div>
          </div>
          <p v-if="!instruments.length" class="muted">The song doesn’t say which instruments it has.</p>
        </div>
        <div v-if="vocals.length" class="vox">
          <span v-for="v in vocals" :key="v.key" class="vchip"><InstIcon name="mic" />{{ v.label }} <small>{{ v.phrases }} lines</small></span>
        </div>
      </section>

      <!-- tab -->
      <section>
        <h3>Tab</h3>
        <div v-if="!song && !err" class="muted">Reading the chart…</div>
        <template v-else-if="tabs">
          <div v-if="tabs.file" class="tabcard">
            <div class="tabhead">
              <div class="fname"><svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>{{ tabs.file }}</div>
              <div v-if="tabs.title" class="muted small">“{{ tabs.title }}”{{ tabs.artist ? ` by ${tabs.artist}` : '' }}</div>
            </div>
            <div v-if="tabs.error" class="error">{{ tabs.error }}</div>
            <template v-else>
              <div class="meter" :class="matchWord.cls">
                <div class="mbar"><i :style="{ width: `${Math.round((match ?? 0) * 100)}%` }" /></div>
                <b>{{ match != null ? `${Math.round(match * 100)}%` : '—' }}</b>
              </div>
              <p class="mword" :class="matchWord.cls">{{ matchWord.text }}</p>
              <ul class="notes">
                <li v-if="ratioText">The tab counts bars differently: {{ ratioText }}</li>
                <li v-if="!tabs.auto">Nudged by hand while playing</li>
                <li v-for="c in tabs.changes" :key="c.name">{{ c.name }}: {{ c.shift === null ? 'left out (not in the recording)' : `moved ${c.shift > 0 ? '+' : ''}${c.shift} bars to follow the recording` }}</li>
              </ul>
              <div class="tracks">
                <div v-for="t in gpTracks" :key="t.id" class="trk">
                  <InstIcon :name="t.kind" /><span class="tn">{{ t.name }}</span>
                  <span class="muted">{{ t.kind === 'keys' ? 'keyboard' : `${t.strings}-string · ${tuningName(t.tuning)}` }} · {{ t.count.toLocaleString() }} notes</span>
                </div>
              </div>
            </template>
          </div>

          <div v-if="proTracks.length" class="tabcard pro">
            <div class="fname">From the chart</div>
            <div class="tracks">
              <div v-for="t in proTracks" :key="t.id" class="trk">
                <InstIcon :name="t.kind" /><span class="tn">{{ t.name }}</span>
                <span class="muted">{{ t.kind === 'keys' ? 'keyboard' : `${tuningName(t.tuning)}${t.tuningFrom === 'assumed' ? ' (assumed)' : ''}` }} · {{ t.count.toLocaleString() }} notes</span>
              </div>
            </div>
          </div>

          <p v-if="!tabs.file && !proTracks.length" class="muted">No tab yet. Add a Guitar Pro file and it lines up with the song by itself.</p>

          <div class="actions">
            <button v-if="yarg.local" class="btn primary" :disabled="!!busy" @click="find">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>{{ tabs.file ? 'Find another tab' : 'Find tab' }}
            </button>
            <button class="btn" :disabled="!!busy" @click="fileInput.click()">{{ busy === 'upload' ? 'Adding…' : tabs.file ? 'Replace with a file…' : '+ Guitar Pro file' }}</button>
            <button v-if="tabs.file" class="btn danger" :disabled="!!busy" @click="remove">Remove</button>
            <input ref="fileInput" type="file" accept=".gp,.gpx,.gp5,.gp4,.gp3" hidden @change="onFile" />
          </div>
          <p v-if="msg" class="msg">{{ msg }}</p>
        </template>
      </section>

      <!-- scores -->
      <section v-if="best || s.plays">
        <h3>Best score</h3>
        <div v-if="best" class="bestcard">
          <div class="bs"><span class="stars">{{ stars(best.stars) }}</span><b>{{ best.score.toLocaleString() }}</b><span class="muted">{{ best.plays }} play{{ best.plays === 1 ? '' : 's' }}<template v-if="best.date"> · best {{ new Date(best.date).toLocaleDateString() }}</template></span></div>
          <table v-if="best.players?.length">
            <tr v-for="(p, i) in best.players" :key="i">
              <td>{{ p.name }}</td><td class="muted">{{ p.instrument }} · {{ p.difficulty }}</td>
              <td class="stars">{{ stars(p.stars) }}</td><td class="num">{{ p.percent != null ? `${Math.round(p.percent * 100)}%` : '' }}</td>
              <td class="num">{{ p.score.toLocaleString() }}</td><td>{{ p.fc ? 'FC' : '' }}</td>
            </tr>
          </table>
        </div>
      </section>

      <!-- sections -->
      <section v-if="sections.length">
        <h3>Sections <small>{{ sections.length }}<template v-if="song?.chart?.bars"> · {{ song.chart.bars }} bars</template></small></h3>
        <div class="secs">
          <span v-for="(x, i) in sections" :key="i" class="sec"><small>{{ fmtTime(x.t) }}</small>{{ x.name }}</span>
        </div>
      </section>

      <p v-if="song" class="path" :title="`${song.folder}/${song.file}`">{{ song.file }}</p>
    </div>
  </Modal>
</template>

<style scoped>
.song { display: flex; flex-direction: column; gap: 18px; }
.hero { display: flex; gap: 18px; align-items: flex-start; }
.art { flex: none; width: 148px; height: 148px; border-radius: 14px; overflow: hidden; background: linear-gradient(135deg, #2a1f3a, #14171c); display: grid; place-items: center; box-shadow: 0 10px 30px #0008; }
.art img { width: 100%; height: 100%; object-fit: cover; }
.art svg { width: 48px; height: 48px; fill: none; stroke: #b48cff; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; opacity: .7; }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.live { align-self: flex-start; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; padding: 3px 8px; border-radius: 6px; background: #10291c; color: var(--ok); }
dl { display: grid; grid-template-columns: auto 1fr; gap: 5px 14px; margin: 0; font-size: 14px; }
dt { color: var(--muted); } dd { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quote { margin: 2px 0 0; font-size: 13px; font-style: italic; color: var(--muted); line-height: 1.45; }
section { display: flex; flex-direction: column; gap: 10px; }
h3 { margin: 0; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
h3 small { font-weight: 600; letter-spacing: 0; text-transform: none; margin-left: 6px; }
.muted { color: var(--muted); } .small { font-size: 12px; }
.error { color: var(--mute); margin: 0; font-size: 13px; }

.insts { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; }
.inst { min-width: 0; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--panel-2); border: 1px solid var(--line); }
.ic { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; font-size: 20px; color: var(--c); background: color-mix(in srgb, var(--c) 16%, transparent); flex: none; }
.il { min-width: 0; }
.nm { font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 6px; }
.pro { font-size: 9px; font-weight: 800; letter-spacing: .08em; padding: 1px 5px; border-radius: 4px; color: var(--c); border: 1px solid color-mix(in srgb, var(--c) 60%, transparent); }
.tier { font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; margin-top: 3px; }
.pips { display: inline-flex; gap: 2px; }
.pips i { width: 7px; height: 7px; border-radius: 50%; background: #ffffff1a; }
.pips i.on { background: var(--c); }
.pips i.on.devil { background: #ff4d4d; box-shadow: 0 0 6px #ff4d4d88; }
.cnt { flex-basis: 100%; opacity: .75; font-size: 11px; }
.vox { display: flex; flex-wrap: wrap; gap: 6px; }
.vchip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 16px; background: #b48cff18; color: #d9ccff; font-size: 13px; font-weight: 600; }
.vchip small { color: var(--muted); font-weight: 500; }

.tabcard { padding: 12px 14px; border-radius: 14px; background: var(--panel-2); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; }
.tabcard.pro { border-color: #1f4a4a; }
.fname { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; word-break: break-word; }
.fname svg { width: 18px; height: 18px; flex: none; fill: none; stroke: var(--muted); stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }
.meter { display: flex; align-items: center; gap: 10px; }
.mbar { flex: 1; height: 8px; border-radius: 4px; background: #ffffff12; overflow: hidden; }
.mbar i { display: block; height: 100%; border-radius: 4px; transition: width .4s ease; }
.meter b { font-size: 18px; font-variant-numeric: tabular-nums; min-width: 48px; text-align: right; }
.good .mbar i { background: linear-gradient(90deg, #2bb673, var(--ok)); } .good b, .mword.good { color: var(--ok); }
.mid .mbar i { background: linear-gradient(90deg, #c99a20, var(--solo)); } .mid b, .mword.mid { color: var(--solo); }
.bad .mbar i { background: linear-gradient(90deg, #c23a30, var(--mute)); } .bad b, .mword.bad { color: var(--mute); }
.mword { margin: -2px 0 0; font-size: 13px; }
.notes { margin: 0; padding-left: 18px; font-size: 13px; color: var(--muted); display: flex; flex-direction: column; gap: 2px; }
.notes:empty { display: none; }
.tracks { display: flex; flex-direction: column; gap: 4px; }
.trk { display: flex; align-items: center; gap: 8px; font-size: 13px; min-width: 0; }
.trk .tn { font-weight: 600; white-space: nowrap; }
.trk .muted { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.btn { display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 14px; border-radius: 10px; background: var(--btn); border: 1px solid var(--line); color: var(--text); font-weight: 700; font-size: 13px; }
.btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
.btn.primary { background: #b48cff; border-color: #b48cff; color: #160d26; }
.btn.danger { color: var(--mute); }
.btn:disabled { opacity: .5; }
.msg { margin: 0; font-size: 13px; color: var(--accent); }

.bestcard { padding: 12px 14px; border-radius: 14px; background: var(--panel-2); border: 1px solid var(--line); }
.bs { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.bs b { font-size: 20px; font-variant-numeric: tabular-nums; }
.bs .muted { font-size: 13px; }
.stars { color: var(--solo); letter-spacing: 1px; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
td { padding: 4px 6px 4px 0; white-space: nowrap; } .num { text-align: right; font-variant-numeric: tabular-nums; }

.secs { display: flex; flex-wrap: wrap; gap: 6px; }
.sec { display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 9px; border-radius: 8px; background: var(--panel-2); border: 1px solid var(--line); font-size: 12px; font-weight: 600; }
.sec small { color: var(--muted); font-variant-numeric: tabular-nums; font-weight: 500; }
.path { margin: 0; font-size: 11px; color: #5a636e; word-break: break-all; }

@media (max-width: 620px) {
  .hero { gap: 12px; }
  .art { width: 96px; height: 96px; }
  .insts { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .inst { padding: 8px; gap: 8px; }
  .ic { width: 30px; height: 30px; font-size: 17px; }
  table td:nth-child(2) { display: none; }
}
</style>
