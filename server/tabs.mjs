// Tablature for the YARG tab: the song chart's own Pro Guitar/Bass parts, or a Guitar Pro file you add.
//
//  * Pro parts come with the chart, already in time (see proPart() in yarg.mjs).
//  * Guitar Pro files (.gp, .gpx, .gp5, .gp4, .gp3) are kept in <data>/tabs/ and matched to the song by
//    artist and title (or the file name "Artist - Title.gp5"). Added by upload, or picked up from the Downloads
//    folder when a matching file is downloaded (after "Find tab" opened the Ultimate Guitar search). alphaTab reads them (all GP formats, repeats
//    and alternate endings played out in order). Each played bar of the tab is laid onto a bar of the chart:
//    a note 3/8 of the way through its tab bar lands 3/8 of the way through the chart bar, so tempo changes
//    follow the chart. Tabs and charts don't always count bars the same way (a song in 6/8 may be tabbed as
//    3/4 but charted as 4/4: two tab bars per chart bar), so the ratio + which tab bar goes with the chart's first
//    bar (the offset) are chosen by matching the tab's note rhythm with the chart's guitar/bass notes. Every ratio
//    is tried: the tab's own tempo can't be trusted (a shuffle tabbed in 12/8 at "85" is one 4/4 bar, not 1.5),
//    and the score counts both the tab notes that land on chart notes and the chart notes the tab leaves bare,
//    since squeezing a tab onto a busy chart puts notes near chart notes by chance. Tabs don't always start on the
//    chart's bar lines either (a pickup written as a full bar, a riff tabbed from the wrong beat), so the offset
//    can be part of a bar when that clearly fits better.
//  * Then section by section: the tab is cut at its section markers and repeat jumps, and each piece is placed
//    on its own, in song order, so a repeat the tab doesn't write out (or a section the band skips) only moves
//    the pieces after it instead of throwing the rest off. Moving a piece costs a few notes' worth of score, so
//    pieces only move when the notes clearly say so. Section names help too: a tab piece starting where the chart
//    has a section of the same kind ("Chorus 3" on "Chorus 3", "Bridge 1" on "Bridge") scores a bonus, because note
//    timing alone can't tell repeated choruses apart. A single offset can still be set by hand.
//
// Track data sent to pages: { id, name, kind, strings, tuning (MIDI, low → high), notes: [[t, dur, string (0 = lowest), fret, flags]], chords: [[t, name]] }
// Keyboard parts (kind 'keys': the chart's Pro Keys, or a Guitar Pro piano/organ/synth track, see isKeys()) go to the
// Keys view instead: notes: [[t, dur, MIDI pitch, hand (0 right, 1 left, -1 not said), flags]], and Pro Keys' ranges.
import fs from 'node:fs';
import path from 'node:path';
import { TAB } from './yarg.mjs';

export const GP_EXT = /\.(gp|gpx|gp5|gp4|gp3)$/i;
const MAX_OFFSET = 48;                                  // tab bars either way
const RATIOS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 3 / 2, 2, 3, 4]; // chart bars per tab bar
const STEPS = 12;                                       // offsets within a bar: twelfths (quarters and thirds)
const NEAR = 0.07;                                      // seconds: a tab note this close to a chart note matches it
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

// Is this Guitar Pro track a keyboard part (piano, organ, synth…)? Newer files (.gp/.gpx) write keyboards as
// staves with no strings; older ones (.gp5/.gp4/.gp3) give every track strings, so there only the instrument
// sound and the name tell. Tab-makers often give vocal lines a synth sound, and leave program 0 (piano) on
// anything, so a name that says otherwise wins, and program 0 alone isn't enough.
const KEYS_NAME = /piano|keys|keyboard|organ|synth|clav|rhodes|wurli|harpsi|mellotron|hammond|moog|celest|e\.?\s?piano|\bpad\b|\bep\b/i;
const NOT_KEYS = /vocal|voice|vox|sing|choir|guitar|gtr|bass|harmonica|drum|perc|sax|trumpet|horn|violin|cello|flute|banjo|mandolin|ukulele/i;
function isKeys(t) {
  const staves = t.staves.filter((s) => !s.isPercussion);
  if (!staves.length) return false;
  const name = t.name || '';
  if (KEYS_NAME.test(name)) return true;
  if (NOT_KEYS.test(name)) return false;
  if (!staves.some((s) => s.tuning?.length)) return true;            // a stave with no strings: written for keyboard
  const p = t.playbackInfo?.program ?? -1;
  return (p >= 1 && p <= 23) || (p >= 80 && p <= 103);                 // pianos, chromatic percussion, organs; synths
}
// A bassline: tabbed on 4 or 5 strings, or named a bass and tuned low. A keyboard-sounding part tabbed like that
// ("Synth Bass" on four strings in Drop D) is played by the bassist too, so it's both a bass tab and a keyboard part.
const isBassTuning = (name, tuning) => tuning.length === 4 || tuning.length === 5 || (/bass/i.test(name || '') && Math.min(...tuning) < 36);
const bassTabbed = (t) => {
  const st = t.staves.find((s) => !s.isPercussion && s.tuning?.length);
  return !!st && isBassTuning(t.name, st.tuning);
};

// song-name matching rules: lower case, no accents/brackets/leading "the", letters+digits only
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)|\[.*?\]/g, '').replace(/^\s*(the|a|an)\s+/, '').replace(/\b(feat|ft)\b\.?.*$/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const songKey = (s) => `${norm(s.artist)}|${norm(s.name)}`;
const r3 = (x) => Math.round(x * 1000) / 1000;

let alphaTabPromise = null;
const alphaTab = () => (alphaTabPromise ??= import('@coderline/alphatab').then((m) => m.default ?? m));

export function createTabs({ dataDir, log, broadcast, onChange = () => {} }) {
  const dir = path.join(dataDir, 'tabs');
  fs.mkdirSync(dir, { recursive: true });
  const indexFile = path.join(dir, 'index.json');
  let index = {};             // songKey -> { file, shift: tab bars added to the automatic placement (0 = automatic) }
  try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch {}
  // synchronous + atomic: quick nudges mustn't land on disk out of order
  const saveIndex = () => { try { fs.writeFileSync(`${indexFile}.tmp`, JSON.stringify(index, null, 2)); fs.renameSync(`${indexFile}.tmp`, indexFile); } catch (e) { log('Tabs: could not save index', e.message); } };

  let song = null;            // { name, artist }
  let chart = null;           // { beats, onsets, pro }
  let gp = null;              // parsed Guitar Pro file: { file, played, tracks } (cached by path + mtime)
  let gpError = '';
  let mapped = { offset: 0, auto: true, tracks: [] }; // GP tracks laid onto the chart's bars
  let version = 0;
  const parsedCache = new Map(); // file -> { mtime, data }

  // ---------- which instruments a file has (for the Library's filters) ----------
  // Reading a file takes a few ms to a tenth of a second, so it's done in the background, one file at a time, and
  // remembered in <data>/tabs/kinds.json by file and date. kindsOf() answers from that (null = not known yet);
  // the library is told to refresh when new answers are in.
  const kindsFile = path.join(dir, 'kinds.json');
  const KINDS_VERSION = 2;     // bumped when the rules for telling instruments apart change: everything is read again
  let kinds = {};              // file -> { mtime, kinds: ['guitar', 'bass', 'keys'] }
  try { const k = JSON.parse(fs.readFileSync(kindsFile, 'utf8')); if (k.version === KINDS_VERSION) kinds = k.files || {}; } catch {}
  const queue = new Set();
  let working = false;
  function kindsOf(file) {
    let mtime;
    try { mtime = Math.round(fs.statSync(path.join(dir, file)).mtimeMs); } catch { return null; }
    const k = kinds[file];
    if (k && k.mtime === mtime) return k.kinds;
    queue.add(file);
    if (!working) { working = true; setTimeout(work, 50); }
    return null;
  }
  async function work() {
    let found = 0;
    for (const file of queue) {
      queue.delete(file);
      const full = path.join(dir, file);
      let mtime;
      try { mtime = Math.round(fs.statSync(full).mtimeMs); } catch { continue; } // gone
      try {
        const A = await alphaTab();
        const score = A.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(fs.readFileSync(full)), new A.Settings());
        const has = new Set();
        for (const t of score.tracks) {
          const notes = t.staves.some((s) => !s.isPercussion && s.bars.some((b) => b.voices.some((v) => v.beats.some((x) => x.notes.length))));
          if (!notes) continue;
          if (isKeys(t)) { has.add('keys'); if (!bassTabbed(t)) continue; }
          const st = t.staves.find((s) => !s.isPercussion && s.tuning?.length);
          if (st) has.add(isBassTuning(t.name, st.tuning) || /bass/i.test(t.name) ? 'bass' : 'guitar');
        }
        kinds[file] = { mtime, kinds: [...has].sort() };
      } catch { kinds[file] = { mtime, kinds: [] }; } // unreadable: read again only if the file changes
      found++;
      await new Promise((r) => setTimeout(r, 5));           // let the server breathe between files
    }
    working = false;
    if (!found) return;
    // forget files that are gone, save, and let the library refresh
    for (const f of Object.keys(kinds)) if (!fs.existsSync(path.join(dir, f))) delete kinds[f];
    try { fs.writeFileSync(`${kindsFile}.tmp`, JSON.stringify({ version: KINDS_VERSION, files: kinds })); fs.renameSync(`${kindsFile}.tmp`, kindsFile); } catch (e) { log('Tabs: could not save kinds', e.message); }
    onChange();
  }
  const current = () => song;

  // ---------- which file goes with this song ----------
  function findFile(s = song, names = null) {
    if (!s) return null;
    const song = s;
    const entry = index[songKey(song)];
    if (entry && fs.existsSync(path.join(dir, entry.file))) return entry.file;
    const want = new Set([norm(`${song.artist} ${song.name}`), norm(`${song.artist} - ${song.name}`), norm(song.name) + norm(song.artist)]);
    let byTitle = null;
    for (const f of names || fs.readdirSync(dir)) {
      if (!GP_EXT.test(f)) continue;
      const base = norm(f.replace(GP_EXT, ''));
      if (want.has(base)) return f;
      if (base === norm(song.name)) byTitle = f;
    }
    return byTitle;
  }

  async function parseGp(file) {
    const full = path.join(dir, file);
    const mtime = fs.statSync(full).mtimeMs;
    const hit = parsedCache.get(full);
    if (hit && hit.mtime === mtime) return hit.data;
    const A = await alphaTab();
    const settings = new A.Settings();
    const score = A.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(fs.readFileSync(full)), settings);
    // bars in the order they're played (repeats, alternate endings, D.S./D.C. expanded)
    // alphaTab can loop forever on some repeat/alternate-ending layouts, eating all memory: count its bar lookups
    // (normal files need a few hundred per played bar) and give up past a cap, playing each bar once instead
    const realBars = score.masterBars;
    let lookups = 0;
    const cap = 5000 * (realBars.length + 10);
    score.masterBars = new Proxy(realBars, {
      get(t, k, r) {
        if (typeof k === 'string' && ++lookups > cap && /^\d+$/.test(k)) throw new Error('repeats loop');
        return Reflect.get(t, k, r);
      },
    });
    let order;
    try {
      const midi = new A.midi.MidiFile();
      const gen = new A.midi.MidiFileGenerator(score, settings, new A.midi.AlphaSynthMidiFileHandler(midi));
      gen.generate();
      order = gen.tickLookup.masterBars.map((m) => ({ mb: m.masterBar, len: Math.max(1, m.end - m.start) }));
    } catch (e) {
      if (e.message !== 'repeats loop') throw e;
      log(`Tabs: ${file}: its repeats can't be played out (alphaTab loops), so each bar is played once`);
      order = realBars.map((mb) => ({ mb, len: Math.max(1, mb.calculateDuration()) }));
    } finally {
      score.masterBars = realBars;
    }
    let tempo = score.tempo || 120;
    const played = order.map(({ mb, len }) => {
      for (const a of mb.tempoAutomations || []) tempo = a.value || tempo;
      return { bar: mb.index, len, sec: (len / 960) * (60 / tempo), section: mb.section?.text || null }; // 960 ticks per quarter
    });
    const tracks = [];
    for (const t of score.tracks) {
      // keyboard parts: real pitches, every staff (right hand on top), for the Keys view
      if (isKeys(t)) {
        const bars = score.masterBars.map(() => ({ notes: [], chords: [] }));
        const two = t.staves.filter((s) => !s.isPercussion).length > 1;
        t.staves.forEach((s, si) => {
          if (s.isPercussion) return;
          s.bars.forEach((bar, bi) => {
            const out = bars[bi];
            if (!out) return;
            for (const v of bar.voices) for (const b of v.beats) {
              if (b.isEmpty || !b.notes.length) continue;
              if (si === 0 && b.hasChord && b.chord?.name) out.chords.push([b.playbackStart, b.chord.name]);
              for (const n of b.notes) {
                if (n.isDead || !(n.realValue > 0)) continue;
                // hand: 0 right, 1 left (the grand staff's lower staff), -1 = the page decides by pitch
                out.notes.push([b.playbackStart, b.playbackDuration, n.realValue, two ? Math.min(1, si) : -1, n.isTieDestination ? TAB.TIE : 0]);
              }
            }
          });
        });
        tracks.push({ name: t.name || `Keys ${t.index + 1}`, kind: 'keys', tuning: [], capo: 0, bars, count: bars.reduce((a, b) => a + b.notes.length, 0) });
        if (!bassTabbed(t)) continue;                       // else: also its tab, below
      }
      const st = t.staves.find((s) => !s.isPercussion && s.tuning?.length);
      if (!st) continue;
      const tuning = [...st.tuning].reverse(); // alphaTab lists high → low; string 1 = lowest
      const bars = st.bars.map((bar) => {
        const notes = [], chords = [];
        for (const v of bar.voices) for (const b of v.beats) {
          if (b.isEmpty || !b.notes.length) continue;
          if (b.hasChord && b.chord?.name) chords.push([b.playbackStart, b.chord.name]);
          for (const n of b.notes) {
            const flags = (n.isDead ? TAB.MUTED : 0) | (n.isGhost ? TAB.GHOST : 0) | (n.bendType ? TAB.BEND : 0) | (n.harmonicType ? TAB.HARMONIC : 0)
              | (n.hammerPullOrigin ? TAB.HAMMER : 0) | (n.slideInType || n.slideOutType ? TAB.SLIDE : 0) | (n.isTieDestination ? TAB.TIE : 0)
              | (n.isPalmMute ? TAB.PALM : 0) | (n.isLeftHandTapped || b.tap ? TAB.TAP : 0);
            notes.push([b.playbackStart, b.playbackDuration, n.string - 1, n.fret, flags]);
          }
        }
        return { notes, chords };
      });
      const kind = isBassTuning(t.name, tuning) || /bass/i.test(t.name) ? 'bass' : 'guitar';
      tracks.push({ name: t.name || `Track ${t.index + 1}`, kind, tuning, capo: st.capo || 0, bars, count: bars.reduce((a, b) => a + b.notes.length, 0) });
    }
    const data = { title: score.title, artist: score.artist, played, tracks: tracks.filter((t) => t.count > 0) };
    parsedCache.set(full, { mtime, data });
    return data;
  }

  // ---------- laying the tab onto the chart's bars ----------
  function chartBars(ch = chart) {
    const bars = (ch?.beats || []).filter(([, k]) => k === 0).map(([t]) => t);
    if (bars.length >= 2) bars.push(bars[bars.length - 1] + (bars[bars.length - 1] - bars[bars.length - 2])); // end of the last bar
    return bars;
  }
  // Tab bar k sits at chart position (k + offset) * q (in chart bars; q = chart bars per tab bar).
  // `offset` is one number, or one per played bar (null = this bar isn't in the recording).
  function layTrack(tr, played, bars, offset, q) {
    const notes = [], chords = [], last = bars.length - 1;
    const at = (P) => { const j = Math.floor(P); return j < 0 || j >= last ? null : bars[j] + (P - j) * (bars[j + 1] - bars[j]); };
    played.forEach((p, k) => {
      const b = tr.bars[p.bar];
      const o = Array.isArray(offset) ? offset[k] : offset;
      if (!b || o === null || o === undefined) return;
      const pos = (tick) => (k + o + tick / p.len) * q;
      for (const [tick, dur, s, fret, flags] of b.notes) {
        const t = at(pos(tick));
        if (t === null) continue;
        const te = at(pos(tick + dur));
        notes.push([r3(t), r3(te === null ? 0 : te - t), s, fret, flags]);
      }
      for (const [tick, name] of b.chords) { const t = at(pos(tick)); if (t !== null) chords.push([r3(t), name]); }
    });
    notes.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    return { notes, chords };
  }
  // the chart's notes for the instrument we line up with, and a "how many tab note times land on one" scorer
  function scorer(gp, chart) {
    const ref = gp.tracks.find((t) => t.kind === 'guitar') || gp.tracks.find((t) => t.kind === 'bass') || gp.tracks[0];
    const onsets = (ref?.kind === 'bass' ? chart?.onsets?.bass : chart?.onsets?.guitar) || chart?.onsets?.guitar || chart?.onsets?.bass;
    if (!ref || !onsets?.length) return null;
    const near = (t) => {
      let lo = 0, hi = onsets.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (onsets[m] < t) lo = m + 1; else hi = m; }
      return Math.min(Math.abs(onsets[lo] - t), lo > 0 ? Math.abs(onsets[lo - 1] - t) : Infinity) < NEAR;
    };
    // the reference track's note times once, in tab-bar units (bar k + position inside it), sorted
    const units = [...new Set(gp.played.flatMap((p, k) => (ref.bars[p.bar]?.notes || []).map(([tick]) => k + tick / p.len)))].sort((a, b) => a - b);
    // hits/total for the note times in tab bars [from, to) placed at `offset`
    const range = (bars, offset, q, from = -Infinity, to = Infinity) => {
      const last = bars.length - 1;
      let hits = 0, total = 0, outside = 0;
      for (const u of units) {
        if (u < from) continue;
        if (u >= to) break;
        const P = (u + offset) * q, j = Math.floor(P);
        if (j < 0 || j >= last) { outside++; continue; }
        total++;
        if (near(bars[j] + (P - j) * (bars[j + 1] - bars[j]))) hits++;
      }
      return { hits, total, outside };
    };
    const score = (bars, offset, q) => range(bars, offset, q);
    score.range = range;
    // the whole tab at one offset: hits, misses, notes outside the song, and chart notes no tab note lands on
    // (all through the song: a tab squeezed into part of it leaves the rest bare)
    score.full = (bars, offset, q) => {
      const last = bars.length - 1, times = [];
      let hits = 0, outside = 0;
      for (const u of units) {
        const P = (u + offset) * q, j = Math.floor(P);
        if (j < 0 || j >= last) { outside++; continue; }
        const t = bars[j] + (P - j) * (bars[j + 1] - bars[j]);
        times.push(t);
        if (near(t)) hits++;
      }
      let bare = times.length ? 0 : onsets.length;
      if (times.length) {
        let i = 0;
        for (const c of onsets) {
          while (i < times.length - 1 && times[i + 1] <= c) i++;
          if (Math.abs(times[i] - c) >= NEAR && (i + 1 >= times.length || Math.abs(times[i + 1] - c) >= NEAR)) bare++;
        }
      }
      const total = times.length;
      return { hits, total, outside, bare, value: hits - 0.5 * (total - hits) - 0.5 * outside - 0.5 * bare };
    };
    score.unitsIn = (from, to) => units.filter((u) => u >= from && u < to).length;
    return score;
  }

  // Pieces of the tab, in played bars [a, b): cut at section markers and repeat jumps; long ones every 16 bars.
  function segments(gp) {
    const P = gp.played, cuts = [0];
    for (let k = 1; k < P.length; k++) {
      if (P[k].section || P[k].bar !== P[k - 1].bar + 1 || k - cuts[cuts.length - 1] >= 16) cuts.push(k);
    }
    return cuts.map((a, i) => ({ a, b: cuts[i + 1] ?? P.length, name: P[a].section || null }));
  }

  // What kind of section a name is ("Pre-Chorus 2a" → { kind: 'prechorus', num: 2 }), for matching tab and chart sections.
  const KINDS = ['prechorus', 'intro', 'verse', 'chorus', 'bridge', 'solo', 'outro', 'break', 'interlude', 'riff', 'breakdown', 'ending', 'refrain'];
  function sectionKind(name) {
    const n = String(name || '').toLowerCase().replace(/pre[\s_-]*chorus/g, 'prechorus');
    const kind = KINDS.filter((k) => new RegExp(`\\b${k}\\b`).test(n)).sort((a, b) => n.indexOf(a) - n.indexOf(b))[0] || null;
    const num = Number((n.match(/\b(\d+)/) || [])[1]) || null;
    return { kind, num };
  }
  // bonus for a tab piece named `name` starting at time t: a chart section starts there too, of the same kind (and number)
  function sectionBonus(chart, name, t, barLen) {
    const secs = chart?.sections || [];
    let best = 0;
    for (const sc of secs) {
      if (Math.abs(sc.t - t) > barLen * 0.35) continue;
      let b = 4; // the tab and chart agree a section starts here
      const a = sectionKind(name), c = sectionKind(sc.name);
      if (a.kind && a.kind === c.kind) b = a.num && a.num === c.num ? 30 : 18;
      best = Math.max(best, b);
    }
    return best;
  }

  // Place each piece (offset, or left out), in order, maximising notes that land on chart notes, minus a cost for
  // every place where consecutive pieces don't follow on directly. Positions are in tab-bar units of the chart.
  function piecewise(gp, chart, bars, q, phase = 0) {
    const score = scorer(gp, chart);
    if (!score) return null;
    const segs = segments(gp);
    const VMIN = -MAX_OFFSET, VMAX = Math.ceil((bars.length - 1) / q) + MAX_OFFSET, N = VMAX - VMIN + 1;
    const NEG = -1e9;
    let dp = new Float64Array(N).fill(NEG), startScore = 0; // startScore: nothing placed yet
    const back = [];
    for (const sg of segs) {
      const notes = score.unitsIn(sg.a, sg.b);
      const cost = 4 + 0.15 * notes; // a jump has to win back this many matched notes
      const next = new Float64Array(N).fill(NEG), from = new Array(N);
      // leave the piece out: end position unchanged
      for (let v = 0; v < N; v++) if (dp[v] > NEG && dp[v] - cost > next[v]) { next[v] = dp[v] - cost; from[v] = { v, o: null }; }
      let nextStart = startScore - cost;
      // place it at offset o: starts at a + o, ends at b + o
      const prefix = new Float64Array(N); let best = NEG, bestAt = -1; const prefixAt = new Int32Array(N);
      for (let v = 0; v < N; v++) { prefix[v] = best; prefixAt[v] = bestAt; if (dp[v] > best) { best = dp[v]; bestAt = v; } }
      for (let o = VMIN - sg.a; o <= VMAX - sg.b; o++) {
        const st = sg.a + o - VMIN, en = sg.b + o - VMIN;
        if (st < 0 || en >= N) continue;
        // notes that land on chart notes, minus half a point for each that doesn't (or falls outside the song):
        // otherwise sliding a piece onto silence or past the end costs nothing and chance matches win
        let gain = 0;
        if (notes) { const r = score.range(bars, o + phase, q, sg.a, sg.b); gain = r.hits - 0.5 * (r.total - r.hits) - 0.5 * r.outside; }
        if (sg.name) {
          const P = (sg.a + o + phase) * q, j = Math.floor(P);
          if (j >= 0 && j < bars.length - 1) gain += sectionBonus(chart, sg.name, bars[j] + (P - j) * (bars[j + 1] - bars[j]), bars[j + 1] - bars[j]);
        }
        let cand = startScore + gain, src = { v: -1, o };          // first placed piece: anywhere
        if (dp[st] + gain > cand) { cand = dp[st] + gain; src = { v: st, o }; }                 // follows on directly
        if (prefix[st] - cost + gain > cand) { cand = prefix[st] - cost + gain; src = { v: prefixAt[st], o }; } // jumps ahead
        if (cand > next[en]) { next[en] = cand; from[en] = src; }
      }
      back.push({ from, startFrom: nextStart });
      dp = next; startScore = nextStart;
    }
    // best end, then walk back
    let v = -1, bestScore = startScore;
    for (let i = 0; i < N; i++) if (dp[i] > bestScore) { bestScore = dp[i]; v = i; }
    const offs = new Array(gp.played.length).fill(null), placed = [];
    for (let s = segs.length - 1; s >= 0; s--) {
      if (v < 0) { placed[s] = null; continue; } // nothing placed yet at this point: the piece was left out
      const src = back[s].from[v];
      placed[s] = src.o === null ? null : src.o + phase;
      if (src.o !== null) for (let k = segs[s].a; k < segs[s].b; k++) offs[k] = placed[s];
      v = src.v;
    }
    let hits = 0, total = 0;
    segs.forEach((sg, s) => { if (placed[s] !== null) { const r = score.range(bars, placed[s], q, sg.a, sg.b); hits += r.hits; total += r.total; } });
    const main = placed.find((o) => o !== null) ?? 0;
    return {
      offs, match: total ? hits / total : 0,
      pieces: segs.map((sg, s) => ({ from: sg.a + 1, to: sg.b, name: sg.name, offset: placed[s] })),
      changes: segs.map((sg, s) => ({ name: sg.name || `bar ${sg.a + 1}`, offset: placed[s] })).filter((x, s) => placed[s] === null || placed[s] !== (s ? placed[s - 1] ?? main : main)),
    };
  }
  // ratio and offset that line the tab up best. Every ratio at whole-bar offsets first; then, for the best ratio,
  // offsets in twelfths of a bar: part of a bar is used only when it clearly beats the best whole bar.
  function bestFit(gp, chart, bars) {
    const score = scorer(gp, chart);
    // the ratio the tab's own tempo implies: often right, sometimes not (see above), so it's only a mild preference
    const est = median(gp.played.map((p) => p.sec)) / median(bars.slice(1).map((t, i) => t - bars[i]));
    const away = (q) => Math.abs(Math.log2(q / est)); // 1 = twice or half what the tempo says
    const closest = [...RATIOS].sort((a, b) => away(a) - away(b))[0];
    if (!score) return { offset: 0, phase: 0, q: closest, match: null };
    let best = null;
    for (const q of RATIOS) {
      for (let o = -MAX_OFFSET; o <= MAX_OFFSET; o++) {
        const r = score.full(bars, o, q);
        // a ratio twice/half the tempo's has to win by a tenth of the tab's notes
        const rank = r.value - 0.1 * (r.total + r.outside) * away(q);
        if (!best || rank > best.rank + 1e-9 || (Math.abs(rank - best.rank) < 1e-9 && q === best.q && Math.abs(o) < Math.abs(best.offset))) best = { offset: o, q, rank, ...r };
      }
    }
    const whole = best;
    for (let i = -MAX_OFFSET * STEPS; i <= MAX_OFFSET * STEPS; i++) {
      if (i % STEPS === 0) continue;
      const r = score.full(bars, i / STEPS, whole.q);
      if (r.value > best.value) best = { offset: i / STEPS, q: whole.q, ...r };
    }
    // a fraction of a bar has to win by a margin: shifting a steady riff by a beat matches nearly as well by chance
    if (best !== whole && best.value - whole.value < Math.max(8, 0.04 * (whole.total + whole.outside))) best = whole;
    const phase = best.offset - Math.floor(best.offset);
    return { offset: best.offset, phase, q: best.q, match: best.total ? best.hits / best.total : 0 };
  }

  // The tab (gp) laid onto a song's chart (chart) for song s: offsets, match and every track's notes in song time.
  function computeMapped(gp, chart, s) {
    const none = { offset: 0, auto: true, autoOffset: 0, q: 1, match: null, changes: [], tracks: [] };
    if (!gp || !chart) return none;
    const bars = chartBars(chart);
    if (bars.length < 3) return none;
    const entry = s && index[songKey(s)];
    const fit = bestFit(gp, chart, bars);
    // automatic: section by section (or the single best offset when there are no chart notes to match against)
    const pw = piecewise(gp, chart, bars, fit.q, fit.phase);
    const autoStart = pw ? pw.offs.find((o) => o !== null) ?? fit.offset : fit.offset;
    // a nudge by hand shifts everything, keeping the section adjustments
    const shift = typeof entry?.shift === 'number' ? entry.shift : 0;
    const offset = pw ? pw.offs.map((o) => (o === null ? null : o + shift)) : fit.offset + shift;
    let match = pw ? pw.match : fit.match;
    if (shift) { const sc = scorer(gp, chart); const r = sc && sc(bars, autoStart + shift, fit.q); match = r ? (r.total ? r.hits / r.total : 0) : null; }
    // one chart beat in tab bars, for nudging by a beat
    let n = 0; const per = [];
    for (const [, k] of chart.beats || []) { if (k === 0 && n) { per.push(n); n = 0; } n++; }
    const beat = 1 / ((median(per) || 4) * fit.q);
    return {
      offset: autoStart + shift, auto: shift === 0, autoOffset: autoStart, q: fit.q, match, beat,
      changes: pw ? pw.changes.map((c) => ({ name: c.name, shift: c.offset === null ? null : c.offset - autoStart })) : [],
      tracks: gp.tracks.map((tr, i) => {
        const laid = layTrack(tr, gp.played, bars, offset, fit.q);
        if (tr.kind === 'keys') laid.notes = joinTies(laid.notes);
        return { id: `gp${i}`, name: tr.name, kind: tr.kind, source: 'gp', strings: tr.tuning.length, tuning: tr.tuning, capo: tr.capo, ...laid };
      }),
    };
  }
  // Keys: a tied note holds the key down, so it lengthens the note it's tied from instead of striking again.
  function joinTies(notes) {
    const out = [], held = new Map(); // pitch -> the note sounding on it
    for (const n of notes) {
      const prev = held.get(n[2]);
      if (n[4] & TAB.TIE && prev && Math.abs(prev[0] + prev[1] - n[0]) < 0.08) { prev[1] = r3(n[0] + n[1] - prev[0]); continue; }
      const m = [n[0], n[1], n[2], n[3], n[4] & ~TAB.TIE];
      held.set(n[2], m);
      out.push(m);
    }
    return out;
  }
  function relayout() { mapped = computeMapped(gp, chart, song); }

  async function load() {
    const my = ++version;
    gp = null; gpError = ''; mapped = { offset: 0, auto: true, tracks: [] };
    const file = findFile();
    if (file) {
      try {
        const data = await parseGp(file);
        if (my !== version) return;
        gp = { file, ...data };
        relayout();
        log(`Tabs: ${file} (${gp.tracks.length} tracks; ${mapped.q} song bars per tab bar, offset ${mapped.offset} tab bars${mapped.auto ? ' (auto)' : ''}; rhythm match ${mapped.match == null ? 'n/a' : `${Math.round(mapped.match * 100)}%`}${mapped.changes?.length ? `; adjusted: ${mapped.changes.map((c) => `${c.name} ${c.shift === null ? 'left out' : `${c.shift > 0 ? '+' : ''}${c.shift} bars`}`).join(', ')}` : ''})`);
      } catch (e) {
        if (my !== version) return;
        gpError = /Cannot find (package|module)/.test(e.message) ? 'Guitar Pro support needs `npm install` in the yargDash folder' : `Couldn't read ${file}: ${e.message}`;
        log('Tabs:', gpError);
      }
    }
    if (my === version) { version++; broadcast({ type: 'yargTabs', tabs: info() }); }
  }

  function proTracks(chart_ = chart) {
    const chart = chart_;
    const out = [];
    const std = { guitar: [40, 45, 50, 55, 59, 64], bass: [28, 33, 38, 43, 48, 53] };
    for (const kind of ['guitar', 'bass']) {
      const p = chart?.pro?.[kind];
      if (!p?.notes.length) continue;
      const strings = kind === 'bass' ? Math.max(4, ...p.notes.map((n) => n[2] + 1)) : 6;
      const fromSong = chart?.tunings?.[kind];
      out.push({ id: `pro-${kind}`, name: kind === 'bass' ? 'Pro Bass (chart)' : 'Pro Guitar (chart)', kind, source: 'chart', strings,
        tuning: fromSong ? fromSong.slice(0, strings) : std[kind].slice(0, strings), tuningFrom: fromSong ? 'song' : 'assumed', notes: p.notes, chords: p.chords });
    }
    // Pro Keys: real keys, already in time; `ranges` = where the 17-key window the player sees moves to
    const k = chart?.pro?.keys;
    if (k?.notes.length) out.push({ id: 'pro-keys', name: 'Pro Keys (chart)', kind: 'keys', source: 'chart', strings: 0, tuning: [], tuningFrom: 'chart', notes: k.notes, chords: [], ranges: k.ranges });
    return out;
  }
  // tuning set by hand for this song (shared by every device): overrides what the chart/file says
  const withTuning = (t) => {
    const set = song && index[songKey(song)]?.tunings?.[t.id];
    return set?.length === t.strings ? { ...t, tuning: set, tuningFrom: 'set' } : { ...t, tuningFrom: t.tuningFrom || 'file' };
  };
  // (a keyboard part none of whose notes land in the song is left out)
  const allTracks = () => [...proTracks(), ...mapped.tracks].filter((t) => t.kind !== 'keys' || t.notes.length).map(withTuning);

  // ---------- adding a file ----------
  // Attach a Guitar Pro file to a song: the one YARG is playing, or `forSong` ({ name, artist }, from the library).
  async function attach(name, buf, forSong = null) {
    const song = forSong || current();
    if (!song) throw new Error('No YARG song is playing to attach the tab to');
    const ext = (name.match(GP_EXT) || [])[0];
    if (!ext) throw new Error('Not a Guitar Pro file (.gp, .gpx, .gp5, .gp4, .gp3)');
    const safe = `${song.artist} - ${song.name}`.replace(/[\/\\:*?"<>|]+/g, '_').slice(0, 120);
    const file = `${safe}${ext.toLowerCase()}`;
    // check it reads before keeping it
    const A = await alphaTab();
    A.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(buf), new A.Settings());
    const old = index[songKey(song)]?.file;
    if (old && old !== file) fs.rmSync(path.join(dir, old), { force: true });
    fs.writeFileSync(path.join(dir, file), buf);
    index[songKey(song)] = { ...index[songKey(song)], file, shift: 0 };
    saveIndex();
    onChange();
    await load();
    return file;
  }

  // Guitar Pro files that land in the Downloads folder (after "Find tab") are attached to the song YARG is playing
  // when their title (inside the file, or else in the file name) is the song's. A file with no title in it is taken
  // only if "Find tab" was used for this song in the last half hour. The download itself is left where it is.
  let findFor = null;            // { song: { name, artist }, at }
  const seen = new Map();        // full path -> mtime already looked at
  async function consider(full) {
    let st;
    try { st = fs.statSync(full); } catch { return; }      // renamed away / removed
    if (!st.isFile() || Date.now() - st.mtimeMs > 10 * 60e3 || seen.get(full) === st.mtimeMs) return;
    seen.set(full, st.mtimeMs);
    // candidates: the song YARG is playing, and the song "Find tab" was last used for (from the library) if recent
    const recent = findFor && Date.now() - findFor.at < 30 * 60e3 ? findFor : null;
    const cands = [song, recent?.song].filter(Boolean);
    if (!cands.length) return;
    const name = path.basename(full), buf = fs.readFileSync(full);
    let meta;
    try {
      const A = await alphaTab();
      const s = A.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(buf), new A.Settings());
      meta = { title: s.title || '', artist: s.artist || '' };
    } catch (e) { log(`Tabs: downloaded ${name} can't be read: ${e.message}`); return; }
    const titled = !!norm(meta.title);
    // titles compared loosely: "Running" and "Runnin'" are the same song
    const loose = (t) => norm(String(t || '').replace(/(\w)in['’]?(?=\s|$)/gi, '$1ing'));
    // the title in the file, or else the file name (tab titles have typos: "Mr. Robotto")
    const fits = (s) => { const want = loose(s.name); return want && (loose(meta.title).includes(want) || loose(name.replace(GP_EXT, '')).includes(want)); };
    // a file with no title in it goes to the song "Find tab" was used for
    const target = cands.find(fits) || (!titled && recent ? recent.song : null);
    if (!target) {
      log(`Tabs: downloaded ${name} (“${meta.title || '?'}” by ${meta.artist || '?'}) isn't ${cands.map((s) => `${s.artist} - ${s.name}`).join(' or ')}: left alone`);
      return;
    }
    try { log(`Tabs: attached downloaded ${name} as ${await attach(name, buf, target)}`); } catch (e) { log(`Tabs: couldn't attach ${name}: ${e.message}`); }
  }
  function watchDownloads(folder) {
    const timers = new Map();
    try {
      const w = fs.watch(folder, (ev, f) => {
        if (!f || !GP_EXT.test(f)) return;  // browsers download to .crdownload/.download/.part and rename at the end
        clearTimeout(timers.get(f));
        timers.set(f, setTimeout(() => { timers.delete(f); consider(path.join(folder, f)); }, 1500));
      });
      w.on('error', (e) => log(`Tabs: stopped watching ${folder}: ${e.message}`));
      log(`Tabs: watching ${folder} for Guitar Pro downloads`);
    } catch (e) { log(`Tabs: can't watch ${folder} for downloads: ${e.message}`); }
  }

  function info() {
    return {
      version,
      song: song ? { name: song.name, artist: song.artist } : null,
      file: gp?.file || null,
      error: gpError,
      offset: mapped.offset, auto: mapped.auto, autoOffset: mapped.autoOffset ?? 0, playedBars: gp?.played.length || 0,
      beat: mapped.beat ?? 0.25,                          // one chart beat, in tab bars (the offset's unit)
      ratio: mapped.q ?? 1, match: mapped.match ?? null, // chart bars per tab bar; share of tab note times that land on chart notes
      changes: mapped.changes || [],                      // tab sections moved from where they'd follow on: { name, shift (tab bars) | null = left out }
      tracks: allTracks().map(({ notes, chords, ...t }) => ({ ...t, count: notes.length })),
    };
  }

  return {
    info,
    // the song YARG is playing (or the menu music) and its chart data; null when nothing is playing
    setSong(meta, chartData) {
      const same = meta && song && songKey(meta) === songKey(song) && chartData === chart;
      if (same) return;
      song = meta; chart = meta ? chartData : null;
      load();
    },
    track(id) {
      const t = allTracks().find((x) => x.id === id);
      return t ? { ...t, version } : null;
    },
    upload: attach,
    // "Find tab": the Ultimate Guitar search for this song (Guitar Pro files only), to open in the Mac's browser.
    // Remembered for a while so a download with no title in it can still be matched to the song (see consider()).
    find(forSong = null) {
      const song = forSong || current();
      if (!song) return null;
      findFor = { song: { name: song.name, artist: song.artist }, at: Date.now() };
      const q = `${song.artist || ''} ${song.name}`.replace(/\(.*?\)|\[.*?\]/g, '').replace(/\s+/g, ' ').trim();
      return `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(q)}&type=500`;
    },
    watchDownloads,
    setOffset(offset) {
      if (!song || !gp) return false;
      const key = songKey(song);
      // stored as a shift from the automatic placement, so nudging keeps the section-by-section adjustments
      // (whole bars or beats: fractions of a tab bar)
      const shift = typeof offset === 'number' ? Math.max(-MAX_OFFSET * 2, Math.min(MAX_OFFSET * 2, Math.round((offset - (mapped.autoOffset ?? 0)) * 96) / 96)) : 0;
      index[key] = { ...index[key], file: gp.file, shift };
      saveIndex();
      relayout();
      version++;
      broadcast({ type: 'yargTabs', tabs: info() });
      return true;
    },
    // tuning for one track of this song: MIDI notes low → high, or null to go back to the chart's/file's
    setTuning(id, tuning) {
      if (!song) return false;
      const t = [...proTracks(), ...mapped.tracks].find((x) => x.id === id);
      if (!t) return false;
      const key = songKey(song), e = { ...index[key] }, tunings = { ...e.tunings };
      if (Array.isArray(tuning) && tuning.length === t.strings && tuning.every((n) => Number.isInteger(n) && n >= 12 && n <= 90)) tunings[id] = tuning;
      else delete tunings[id];
      if (Object.keys(tunings).length) e.tunings = tunings; else delete e.tunings;
      if (Object.keys(e).length) index[key] = e; else delete index[key];
      saveIndex();
      version++;
      broadcast({ type: 'yargTabs', tabs: info() });
      return true;
    },
    remove(forSong = null) {
      const s = forSong || current();
      const file = forSong ? findFile(forSong) : gp?.file;
      if (!s || !file) return false;
      fs.rmSync(path.join(dir, file), { force: true });
      const { tunings } = index[songKey(s)] || {};
      if (tunings) index[songKey(s)] = { tunings }; else delete index[songKey(s)];
      saveIndex();
      onChange();
      if (!forSong || (song && songKey(song) === songKey(forSong))) load();
      return true;
    },
    // The Guitar Pro file kept for a song ({ name, artist }), or null: quick, for the library list.
    fileFor: (s) => { try { return findFile(s); } catch { return null; } },
    // the instruments in a kept Guitar Pro file (['guitar', 'keys'], …), or null while it hasn't been read yet
    kindsOf,
    // the same for many songs at once (the tabs folder is read once)
    filesFor(list) {
      let names = [];
      try { names = fs.readdirSync(dir).filter((f) => GP_EXT.test(f)); } catch {}
      return list.map((s) => { try { return findFile(s, names); } catch { return null; } });
    },
    // How a song's tabs look without playing it: its chart's Pro parts and its Guitar Pro file, lined up with the chart.
    async analyze(s, chartData) {
      const out = { file: null, error: '', match: null, ratio: 1, changes: [], auto: true, tracks: [] };
      out.tracks.push(...proTracks(chartData).map((t) => ({ id: t.id, name: t.name, kind: t.kind, source: 'chart', strings: t.strings, tuning: t.tuning, tuningFrom: t.tuningFrom, count: t.notes.length })));
      const file = findFile(s);
      if (!file) return out;
      out.file = file;
      try {
        const g = { file, ...(await parseGp(file)) };
        const m = computeMapped(g, chartData, s);
        Object.assign(out, { match: m.match ?? null, ratio: m.q ?? 1, auto: m.auto, changes: m.changes || [], title: g.title || '', artist: g.artist || '' });
        out.tracks.push(...g.tracks.map((tr, i) => ({ id: `gp${i}`, name: tr.name, kind: tr.kind, source: 'gp', strings: tr.tuning.length, tuning: tr.tuning, count: tr.count })));
        out.playedBars = g.played.length;
      } catch (e) { out.error = `Couldn't read ${file}: ${e.message}`; }
      return out;
    },
  };
}
