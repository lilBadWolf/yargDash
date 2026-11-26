// Chorus Encore (https://www.enchor.us), the Clone Hero / YARG chart search: search it from the Library and download
// a chart's .sng into one of YARG's song folders, remembering which charts were downloaded.
//
//  * Search:    POST https://api.enchor.us/search { search, page, instrument, difficulty, … } (the site's own API;
//               source "api" = a third-party client), or /search/advanced { artist: {value, exact, exclude}, name, … }
//               when an artist is given. Results are charts, 10 songs (general) or 10 charts (advanced) a page;
//               `found` counts the same unit, so pages = ceil(found / 10).
//  * Download:  https://files.enchor.us/[charts/v<encoderVersion>/]<md5>[_novideo].sng, one at a time, into YARG's
//               first song folder (or config encoreDir), named like Encore names them: "Artist - Name (Charter).sng".
//               The video-less file is used when there is one (yargDash doesn't show video; it's much smaller).
//  * Have it?   "Downloaded": this exact chart is in the library. Encore's md5 isn't a hash of the file, so it's matched
//               by size: a library .sng with the same name and artist whose size is that of Encore's file (a HEAD
//               request, only for results whose song is in the library). Charts downloaded here are also remembered in
//               <data>/encore.json { charts: { <md5>: { file, chartId, name, artist, charter, at } } } while their file is there.
//               "In library": the song (name and artist) is in the library, as some other chart or version.
//
// Exports createEncore({ dataDir, log, broadcast, library, getDir, version }) ->
//   { search({ q, artist, page, instrument }), download(md5), status(), folder(), close() }
// SSE: encore { md5, state: 'queued' | 'downloading' | 'done' | 'error', got, total, error }
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';

const API = 'https://api.enchor.us';
const FILES = 'https://files.enchor.us';
const INSTRUMENTS = ['guitar', 'guitarcoop', 'rhythm', 'bass', 'drums', 'keys', 'guitarghl', 'guitarcoopghl', 'rhythmghl', 'bassghl'];
const DIFFICULTIES = ['expert', 'hard', 'medium', 'easy'];
// Encore's difficulty fields -> the library's part keys (library.mjs PARTS)
const PARTS = { guitar: 'diff_guitar', rhythm: 'diff_rhythm', coop: 'diff_guitar_coop', bass: 'diff_bass', drums: 'diff_drums',
  proDrums: 'diff_drums_real', keys: 'diff_keys', vocals: 'diff_vocals', ghl: 'diff_guitarghl', ghlBass: 'diff_bassghl' };

const strip = (s) => String(s ?? '').replace(/<[^>]*>/g, '').trim();
const norm = (s) => strip(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const songKey = (name, artist) => `${norm(name)}\n${norm(artist)}`;
const safeName = (s) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 150);

export function createEncore({ dataDir, log, broadcast, library, getDir, version = '' }) {
  const recFile = path.join(dataDir, 'encore.json');
  let charts = {};
  try { charts = JSON.parse(fs.readFileSync(recFile, 'utf8')).charts || {}; } catch {}
  const save = () => {
    try { fs.writeFileSync(`${recFile}.tmp`, JSON.stringify({ charts }, null, 1)); fs.renameSync(`${recFile}.tmp`, recFile); }
    catch (e) { log('Encore: could not save', e.message); }
  };
  const headers = { 'User-Agent': `yargDash/${version}`, Accept: 'application/json' };

  const seen = new Map();   // md5 -> chart from a search (what a download needs), most recent last
  const jobs = new Map();   // md5 -> { state, got, total, error }
  const queue = [];
  let busy = false;

  function folder() {
    const set = getDir();
    if (set) return set;
    return library.folders()[0] || '';
  }
  const downloaded = (md5) => { const r = charts[md5]; return !!(r && fs.existsSync(r.file)); };

  // sizes of a chart's files on Encore (with and without video), cached: md5 -> Promise<number[]>
  const sizes = new Map();
  function sizesOf(c) {
    if (!sizes.has(c.md5)) {
      const base = `${FILES}/${Number(c.encoderVersion) ? `charts/v${c.encoderVersion}/` : ''}${c.md5}`;
      const head = (u) => fetch(u, { method: 'HEAD', headers: { 'User-Agent': headers['User-Agent'] }, signal: AbortSignal.timeout(6000) })
        .then((r) => (r.ok ? Number(r.headers.get('content-length')) || 0 : 0)).catch(() => 0);
      const p = Promise.all([head(`${base}.sng`), c.hasVideoBackground ? head(`${base}_novideo.sng`) : 0]).then((a) => a.filter(Boolean));
      p.then((a) => { if (!a.length) sizes.delete(c.md5); }); // try again next time
      sizes.set(c.md5, p);
      while (sizes.size > 3000) sizes.delete(sizes.keys().next().value);
    }
    return sizes.get(c.md5);
  }

  function chartOut(c) {
    const parts = {};
    for (const [k, f] of Object.entries(PARTS)) if (Number(c[f]) >= 0) parts[k] = Number(c[f]);
    if (parts.proDrums == null && parts.drums != null && c.pro_drums) parts.proDrums = parts.drums;
    if (c.notesData?.hasVocals && parts.vocals == null) parts.vocals = -1;
    return {
      md5: c.md5, chartId: c.chartId, name: strip(c.name), artist: strip(c.artist), album: strip(c.album), genre: strip(c.genre),
      year: strip(c.year), charter: strip(c.charter), length: (Number(c.song_length) || 0) / 1000, parts,
      art: c.albumArtMd5 ? `${FILES}/${c.albumArtMd5}.jpg` : null, modified: c.modifiedTime || null,
      lyrics: !!c.notesData?.hasLyrics, video: !!c.hasVideoBackground,
    };
  }

  async function search({ q = '', artist = '', page = 1, instrument = null, difficulty = null } = {}) {
    const search = String(q).trim().slice(0, 300), by = String(artist || '').trim().slice(0, 300);
    if (!search && !by) return { found: 0, page: 1, pages: 0, charts: [] };
    const common = { page: Math.max(1, Math.min(100, Number(page) || 1)), instrument: INSTRUMENTS.includes(instrument) ? instrument : null,
      difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : null, drumType: null, drumsReviewed: true, source: 'api' };
    const field = (value) => (value ? { value, exact: false, exclude: false } : null);
    // an artist: the advanced search, with the search box as the song name
    const [route, body] = by ? ['search/advanced', { ...common, artist: field(by), name: field(search) }] : ['search', { ...common, search }];
    const r = await fetch(`${API}/${route}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (r.status === 429) throw new Error('Encore says to slow down: try again in a minute');
    if (!r.ok) throw new Error(`Encore search failed (${r.status})`);
    const j = await r.json();
    // library songs by name and artist: their .sng sizes
    const owned = new Map();
    for (const e of library.entries()) {
      const k = songKey(e.name, e.artist);
      if (!owned.has(k)) owned.set(k, []);
      if (/\.sng$/i.test(e.location)) owned.get(k).push(e.size);
    }
    const out = await Promise.all((j.data || []).filter((c) => /^[a-f0-9]{32}$/i.test(c.md5 || '')).map(async (c) => {
      seen.delete(c.md5);
      seen.set(c.md5, { md5: c.md5, encoderVersion: Number(c.encoderVersion) || 0, video: !!c.hasVideoBackground, chartId: c.chartId,
        name: strip(c.name), artist: strip(c.artist), charter: strip(c.charter) });
      const o = chartOut(c);
      const mine = owned.get(songKey(o.name, o.artist));
      let have = downloaded(c.md5);
      if (!have && mine?.length) have = (await sizesOf(c)).some((n) => mine.includes(n));
      return { ...o, downloaded: have, inLibrary: !!mine, job: jobs.get(c.md5) || null };
    }));
    while (seen.size > 3000) seen.delete(seen.keys().next().value);
    const found = Number(j.found) || 0;
    return { found, page: body.page, pages: out.length ? Math.ceil(found / 10) : body.page, unit: by ? 'charts' : 'songs', charts: out };
  }

  function send(md5) { broadcast({ type: 'encore', md5, ...jobs.get(md5) }); }

  function download(md5) {
    const c = seen.get(md5);
    if (!c) throw new Error('Search for it again first');
    if (jobs.has(md5) && ['queued', 'downloading'].includes(jobs.get(md5).state)) return { state: jobs.get(md5).state };
    if (!folder()) throw new Error('YARG has no song folder to download into: add one in YARG (Settings → Songs)');
    jobs.set(md5, { state: 'queued', got: 0, total: 0 });
    queue.push(md5);
    send(md5);
    pump();
    return { state: 'queued' };
  }

  const fetchSng = (url) => fetch(url, { headers: { 'User-Agent': headers['User-Agent'] }, signal: AbortSignal.timeout(10 * 60e3) });

  async function pump() {
    if (busy) return;
    const md5 = queue.shift();
    if (!md5) return;
    busy = true;
    const c = seen.get(md5);
    const job = jobs.get(md5);
    let tmp = null;
    try {
      const dir = folder();
      fs.mkdirSync(dir, { recursive: true });
      const base = `${c.encoderVersion ? `charts/v${c.encoderVersion}/` : ''}${md5}`;
      let r = c.video ? await fetchSng(`${FILES}/${base}_novideo.sng`) : null;
      if (!r?.ok) r = await fetchSng(`${FILES}/${base}.sng`);
      if (!r.ok) throw new Error(r.status === 404 ? 'Encore doesn’t have this file any more' : `download failed (${r.status})`);
      let name = safeName(`${c.artist} - ${c.name} (${c.charter})`) || md5;
      if (fs.existsSync(path.join(dir, `${name}.sng`))) name += ` ${md5.slice(0, 6)}`; // another chart of the same song
      const file = path.join(dir, `${name}.sng`);
      tmp = `${file}.part`;
      Object.assign(job, { state: 'downloading', total: Number(r.headers.get('content-length')) || 0, got: 0 });
      send(md5);
      const ws = fs.createWriteStream(tmp);
      let lastSent = 0;
      for await (const chunk of r.body) {
        job.got += chunk.length;
        if (!ws.write(chunk)) await once(ws, 'drain');
        if (Date.now() - lastSent > 250) { lastSent = Date.now(); send(md5); }
      }
      ws.end();
      await once(ws, 'finish');
      const head = Buffer.alloc(6);
      const fd = fs.openSync(tmp, 'r'); fs.readSync(fd, head, 0, 6, 0); fs.closeSync(fd);
      if (head.toString('latin1') !== 'SNGPKG') throw new Error('Encore sent something that isn’t an .sng');
      fs.renameSync(tmp, file);
      tmp = null;
      charts[md5] = { file, chartId: c.chartId, name: c.name, artist: c.artist, charter: c.charter, at: Date.now() };
      save();
      Object.assign(job, { state: 'done', got: job.total || job.got });
      log(`Encore: downloaded ${c.artist} - ${c.name} (${c.charter}) to ${file}`);
      send(md5);
      library.rescan('Encore download');
    } catch (e) {
      if (tmp) fs.rm(tmp, { force: true }, () => {});
      Object.assign(job, { state: 'error', error: e.message });
      log(`Encore: ${c?.artist} - ${c?.name}: ${e.message}`);
      send(md5);
    } finally {
      busy = false;
      pump();
    }
  }

  return {
    search,
    download,
    folder,
    // inSongFolders: YARG (and the Library) only see songs in its song folders
    status: () => {
      const f = folder();
      const inSongFolders = !!f && library.folders().some((d) => { const rel = path.relative(d, f); return !rel.startsWith('..') && !path.isAbsolute(rel); });
      return { folder: f, inSongFolders, downloaded: Object.keys(charts).filter(downloaded).length, jobs: Object.fromEntries(jobs) };
    },
    close() {},
  };
}
