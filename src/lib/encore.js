// Chorus Encore (enchor.us) from the Library: search it through the server (server/encore.mjs) and download charts
// into YARG's song folders. Kept at module level so the search survives switching views.
import { reactive } from 'vue';

export const encore = reactive({
  q: '',
  artist: '',        // set: search by artist (Encore's advanced search), q is then the song name
  instrument: '',    // '' = any, else guitar | bass | drums | keys | …
  ran: null,         // the search the results are for: { q, artist, instrument }
  page: 1,
  pages: 0,
  found: 0,
  unit: 'songs',     // what `found` counts: songs (a general search) or charts (by artist)
  charts: [],        // [{ md5, name, artist, album, year, charter, length, parts, art, downloaded, inLibrary, job }]
  loading: false,
  error: '',
  jobs: {},          // md5 -> { state: queued | downloading | done | error, got, total, error }
});

export const ENCORE_INSTRUMENTS = [['', 'Any instrument'], ['guitar', 'Guitar'], ['bass', 'Bass'], ['drums', 'Drums'], ['keys', 'Keys'], ['rhythm', 'Rhythm'], ['guitarcoop', 'Co-op'], ['guitarghl', '6-fret']];

async function call(url, body) {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' } });
  const j = await r.json().catch(() => ({ error: `failed (${r.status})` }));
  if (!r.ok) throw new Error(j.error || 'failed');
  return j;
}

// more: load the next page of the same search
export async function searchEncore(more = false) {
  if (encore.loading) return;
  const s = more ? encore.ran : { q: encore.q.trim(), artist: encore.artist.trim(), instrument: encore.instrument || null };
  if (!s || (!s.q && !s.artist) || (more && encore.page >= encore.pages)) return;
  encore.loading = true; encore.error = '';
  if (!more) encore.charts = [];
  try {
    const page = more ? encore.page + 1 : 1;
    const j = await call('/encore/search', { ...s, page });
    for (const c of j.charts) if (c.job) encore.jobs[c.md5] = c.job;
    const have = new Set(encore.charts.map((c) => c.md5));
    encore.charts = [...encore.charts, ...j.charts.filter((c) => !have.has(c.md5))];
    Object.assign(encore, { ran: s, page: j.page, pages: j.pages, found: j.found, unit: j.unit || 'songs' });
  } catch (e) { encore.error = e.message; }
  finally { encore.loading = false; }
}

export async function downloadChart(c) {
  encore.jobs[c.md5] = { state: 'queued', got: 0, total: 0 };
  try { await call('/encore/download', { md5: c.md5 }); }
  catch (e) { encore.jobs[c.md5] = { state: 'error', error: e.message }; }
}

export const encoreStatus = () => fetch('/encore/status').then((r) => r.json());

export function onEncoreMessage(msg) {
  if (msg.type !== 'encore') return;
  const { type, md5, ...job } = msg;
  encore.jobs[md5] = job;
  if (job.state === 'done') { const c = encore.charts.find((x) => x.md5 === md5); if (c) { c.downloaded = true; c.inLibrary = true; } }
}
