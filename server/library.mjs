// YARG's song library, for the Library view: every song in the folders YARG reads (its settings.json SongFolders),
// with what's in it (instruments and difficulty, from each song's metadata), whether it has a tab, and YARG's scores.
//
//  * Songs: .sng files and folders with a song.ini (Clone Hero / YARG style). Rock Band CON/rb3con packs aren't read.
//  * Each song's metadata is kept in <data>/library.json by path, size and date, so a rescan only reads new or
//    changed songs. Rescanned at start, when asked (POST /library/rescan), and every 10 minutes.
//  * One song in full (GET /library/song?id=): its chart read for the parts it actually has, vocal parts, sections
//    and tempo, plus its tabs lined up with the chart (tabs.analyze) and its best score.
//
//  * Practice (YARG not running): a song's audio stems (song.ogg, guitar.ogg, …, or the same inside an .sng), served
//    in byte ranges so a page's <audio> can seek in them.
//
// Exports createLibrary({ dataDir, log, broadcast, yarg, tabs }) ->
//   { list(), song(id), art(id), meta(id), entries(), folders(), stems(id), stem(id, name), rescan(), close() }
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { songMetadata, loadLyrics, readSngFiles, listSngFiles, readSngRange } from './yarg.mjs';

// Instruments in a song, from its metadata's difficulty tiers (diff_* = -1 when the part isn't charted).
const PARTS = [
  ['guitar', 'Guitar', ['diff_guitar']],
  ['rhythm', 'Rhythm', ['diff_rhythm']],
  ['coop', 'Co-op', ['diff_guitar_coop']],
  ['bass', 'Bass', ['diff_bass']],
  ['drums', 'Drums', ['diff_drums']],
  ['keys', 'Keys', ['diff_keys']],
  ['vocals', 'Vocals', ['diff_vocals']],
  ['harmonies', 'Harmonies', ['diff_vocals_harm']],
  ['proGuitar', 'Pro Guitar', ['diff_guitar_real', 'diff_guitar_real_22']],
  ['proBass', 'Pro Bass', ['diff_bass_real', 'diff_bass_real_22']],
  ['proDrums', 'Pro Drums', ['diff_drums_real']],
  ['proKeys', 'Pro Keys', ['diff_keys_real']],
  ['ghl', '6-fret Guitar', ['diff_guitarghl']],
  ['ghlBass', '6-fret Bass', ['diff_bassghl']],
];
export const PART_NAMES = Object.fromEntries(PARTS.map(([k, n]) => [k, n]));

const strip = (s) => String(s ?? '').replace(/<[^>]*>/g, '').trim();
const idOf = (loc) => crypto.createHash('sha1').update(loc).digest('hex').slice(0, 16);
const ART = ['album.png', 'album.jpg', 'album.jpeg'];
// audio stems, in the order a mixer shows them (preview and crowd aren't the song)
const AUDIO = /\.(ogg|opus|mp3|wav|flac)$/i;
const STEM_ORDER = ['song', 'guitar', 'rhythm', 'bass', 'drums', 'keys', 'vocals', 'backing'];
const stemRank = (n) => { const i = STEM_ORDER.findIndex((k) => n === k || n.startsWith(`${k}_`)); return i < 0 ? STEM_ORDER.length : i; };
const AUDIO_TYPE = { ogg: 'audio/ogg', opus: 'audio/ogg; codecs=opus', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac' };

function entryFrom(loc, st, meta) {
  const parts = {};
  for (const [key, , keys] of PARTS) {
    const v = Math.max(-1, ...keys.map((k) => (meta[k] != null && meta[k] !== '' ? Number(meta[k]) : -1)).filter((n) => Number.isFinite(n)));
    if (v >= 0) parts[key] = v;
  }
  // older charts: pro drums marked with pro_drums = True instead of their own tier
  if (parts.proDrums == null && parts.drums != null && /^true$/i.test(meta.pro_drums || '')) parts.proDrums = parts.drums;
  return {
    id: idOf(loc), location: loc, size: st.size, mtime: Math.round(st.mtimeMs),
    name: strip(meta.name) || path.basename(loc).replace(/\.sng$/i, ''), artist: strip(meta.artist), album: strip(meta.album),
    genre: strip(meta.genre), year: strip(meta.year).replace(/^,\s*/, ''), charter: strip(meta.charter || meta.frets),
    length: (Number(meta.song_length) || 0) / 1000, parts, loading: strip(meta.loading_phrase),
  };
}

export function createLibrary({ dataDir, log, broadcast, yarg, tabs }) {
  const cacheFile = path.join(dataDir, 'library.json');
  let byLoc = new Map();       // location -> entry
  try { for (const e of JSON.parse(fs.readFileSync(cacheFile, 'utf8')).songs || []) byLoc.set(e.location, e); } catch {}
  let byId = new Map([...byLoc.values()].map((e) => [e.id, e]));
  let folders = [], scanning = null, scannedAt = 0, version = 0, lastError = '';

  // the song folders YARG reads, from its settings.json
  function songFolders() {
    const dir = yarg.dataDir();
    try { return (JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).SongFolders || []).filter((f) => typeof f === 'string' && f); }
    catch { return []; }
  }

  async function walk(root, found, depth = 0) {
    let list;
    try { list = await fs.promises.readdir(root, { withFileTypes: true }); } catch { return; }
    if (list.some((d) => d.isFile() && d.name.toLowerCase() === 'song.ini')) { found.push(root); return; }
    for (const d of list) {
      if (d.name.startsWith('.')) continue;
      const full = path.join(root, d.name);
      if (d.isFile() && /\.sng$/i.test(d.name)) found.push(full);
      else if ((d.isDirectory() || d.isSymbolicLink()) && depth < 12) await walk(full, found, depth + 1);
    }
  }

  async function scan(why) {
    folders = songFolders();
    const found = [];
    for (const f of folders) await walk(f, found);
    const next = new Map();
    let read = 0;
    for (const loc of found) {
      try {
        const statPath = /\.sng$/i.test(loc) ? loc : path.join(loc, 'song.ini');
        const st = await fs.promises.stat(statPath);
        const old = byLoc.get(loc);
        if (old && old.size === st.size && old.mtime === Math.round(st.mtimeMs)) { next.set(loc, old); continue; }
        next.set(loc, entryFrom(loc, st, songMetadata(loc)));
        if (++read % 200 === 0) await new Promise((r) => setImmediate(r)); // stay responsive on big libraries
      } catch (e) { log(`Library: skipped ${loc}: ${e.message}`); }
    }
    const changed = next.size !== byLoc.size || read > 0 || [...byLoc.keys()].some((k) => !next.has(k));
    byLoc = next;
    byId = new Map([...next.values()].map((e) => [e.id, e]));
    scannedAt = Date.now();
    lastError = folders.length ? '' : 'YARG has no song folders set (or its settings.json wasn\'t found)';
    if (changed) {
      try { fs.writeFileSync(`${cacheFile}.tmp`, JSON.stringify({ songs: [...next.values()] })); fs.renameSync(`${cacheFile}.tmp`, cacheFile); } catch (e) { log('Library: could not save', e.message); }
    }
    log(`Library: ${next.size} songs in ${folders.length} folder${folders.length === 1 ? '' : 's'}${read ? ` (${read} read)` : ''}${why ? ` [${why}]` : ''}`);
    if (changed) bump();
  }

  function bump() { version++; broadcast({ type: 'library', version }); }

  function rescan(why = '') {
    if (scanning) return scanning;
    scanning = scan(why).catch((e) => { lastError = e.message; log('Library: scan failed:', e.message); }).finally(() => { scanning = null; });
    return scanning;
  }
  rescan('start');
  const timer = setInterval(() => rescan(), 10 * 60e3);

  return {
    version: () => version,
    bump,
    rescan,
    // Every song, with its tab file and play stats (sorted by artist, then name)
    list() {
      const songs = [...byLoc.values()];
      const files = tabs.filesFor(songs);
      const stats = yarg.playStats();
      return {
        version, scanning: !!scanning, scannedAt, folders, error: lastError,
        songs: songs.map((e, i) => {
          const st = stats[`${e.name}\n${e.artist}`];
          const { location, size, loading, ...rest } = e;
          // keysTab: its Guitar Pro file has a keyboard part (null: the file hasn't been read yet)
          const kinds = files[i] ? tabs.kindsOf(files[i]) : [];
          return { ...rest, file: path.basename(location), tab: files[i] ? 'gp' : e.parts.proGuitar != null || e.parts.proBass != null ? 'pro' : null,
            keysTab: kinds ? kinds.includes('keys') : null,
            plays: st?.plays || 0, stars: st?.stars || 0, score: st?.score || 0 };
        }).sort((a, b) => a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
      };
    },
    meta: (id) => byId.get(id) || null,
    entries: () => [...byLoc.values()],
    folders: () => (folders.length ? folders : songFolders()),
    // One song in full: what its chart really has, its tabs lined up, and its best score
    async song(id) {
      const e = byId.get(id);
      if (!e) return null;
      const out = { ...e, file: path.basename(e.location), folder: path.dirname(e.location), partNames: PART_NAMES, chart: null, chartError: '', tabs: null, best: null };
      let chart = null;
      try {
        chart = loadLyrics(e.location);
        const lanes = Object.fromEntries(Object.entries(chart.lanes || {}).map(([k, v]) => [k, { name: v.name, notes: v.notes?.length || 0 }]));
        const beats = chart.beats || [];
        const bars = beats.filter(([, k]) => k === 0).map(([t]) => t);
        // typical tempo: median beat length
        const gaps = beats.slice(1).map(([t], i) => t - beats[i][0]).filter((g) => g > 0.15 && g < 2).sort((a, b) => a - b);
        const bpm = gaps.length ? Math.round(60 / gaps[gaps.length >> 1]) : null;
        out.chart = {
          lanes,
          vocals: Object.fromEntries(Object.entries(chart.parts || {}).map(([k, v]) => [k, v.phrases?.length || 0])),
          pro: Object.keys(chart.pro || {}).filter((k) => chart.pro[k]?.notes?.length),
          sections: (chart.sections || []).map((s) => ({ t: s.t, name: s.name })),
          bars: bars.length, bpm,
        };
      } catch (err) { out.chartError = err.message; }
      try { out.tabs = await tabs.analyze({ name: e.name, artist: e.artist }, chart); } catch (err) { out.tabs = { error: err.message, tracks: [] }; }
      out.best = yarg.bestFor(e.name, e.artist);
      delete out.location;
      return out;
    },
    // album art: { type, data } or null
    art(id) {
      const e = byId.get(id);
      if (!e) return null;
      try {
        if (/\.sng$/i.test(e.location)) {
          const files = readSngFiles(e.location, ART);
          for (const n of ART) if (files.get(n)) return { type: n.endsWith('png') ? 'image/png' : 'image/jpeg', data: files.get(n) };
        } else {
          for (const f of fs.readdirSync(e.location)) {
            if (ART.includes(f.toLowerCase())) return { type: f.toLowerCase().endsWith('png') ? 'image/png' : 'image/jpeg', data: fs.readFileSync(path.join(e.location, f)) };
          }
        }
      } catch {}
      return null;
    },
    // A song's audio stems and chart offset, for practice: { stems: [{ name, size }], delay (s: audio time of chart time 0) }
    stems(id) {
      const e = byId.get(id);
      if (!e) return null;
      let files = [];
      if (/\.sng$/i.test(e.location)) files = listSngFiles(e.location).map((f) => ({ name: f.name, size: f.len }));
      else {
        for (const f of fs.readdirSync(e.location)) {
          try { files.push({ name: f, size: fs.statSync(path.join(e.location, f)).size }); } catch {}
        }
      }
      const base = (n) => n.toLowerCase().replace(AUDIO, '');
      const stems = files.filter((f) => AUDIO.test(f.name) && !['preview', 'crowd'].includes(base(f.name)) && f.size > 0)
        .sort((a, b) => stemRank(base(a.name)) - stemRank(base(b.name)) || a.name.localeCompare(b.name));
      const delay = (Number(songMetadata(e.location).delay) || 0) / 1000;
      return { stems, delay };
    },
    // One stem: { size, type, read(start, end) -> Promise<Buffer | ReadStream> } or null
    stem(id, name) {
      const e = byId.get(id);
      const st = e && this.stems(id)?.stems.find((s) => s.name === name);
      if (!st) return null;
      const type = AUDIO_TYPE[name.split('.').pop().toLowerCase()] || 'application/octet-stream';
      if (/\.sng$/i.test(e.location)) return { size: st.size, type, read: (start, end) => readSngRange(e.location, name, start, end) };
      const file = path.join(e.location, name);
      return { size: st.size, type, read: (start, end) => fs.createReadStream(file, { start, end }) };
    },
    close() { clearInterval(timer); },
  };
}
