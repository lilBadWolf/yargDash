// YARG's song library from the server (server/library.mjs): the list for the Library view, one song in full for its
// modal, and adding/finding/removing a song's tab. The server says when the library changes ({type:'library'}).
import { reactive } from 'vue';

export const library = reactive({
  version: -1,       // the server's library version (bumped on rescans and tab changes)
  loaded: -1,        // version of the list we have
  loading: false,
  error: '',
  scanning: false,
  scannedAt: 0,
  folders: [],
  songs: [],         // [{ id, name, artist, album, genre, year, charter, length, parts: {key: tier}, tab: 'gp'|'pro'|null, keysTab: bool|null, plays, stars, score, mtime, file }]
});

export async function loadLibrary(force = false) {
  if (library.loading || (!force && library.loaded === library.version && library.loaded >= 0)) return;
  library.loading = true;
  try {
    const r = await fetch('/library');
    if (r.status === 404) throw new Error('The server is out of date: restart it (Settings → Restart server) to browse the library.');
    if (!r.ok) throw new Error(`library: ${r.status}`);
    const j = await r.json();
    Object.assign(library, { songs: j.songs, folders: j.folders, scanning: j.scanning, scannedAt: j.scannedAt, error: j.error || '', loaded: j.version });
    if (library.version < j.version) library.version = j.version;
  } catch (e) { library.error = e.message; }
  finally { library.loading = false; }
}

export function onLibraryMessage(msg) {
  if (msg.type === 'snapshot' && typeof msg.library === 'number') library.version = msg.library;
  if (msg.type === 'library') library.version = msg.version;
}

export async function rescanLibrary() {
  library.scanning = true;
  try { await fetch('/library/rescan', { method: 'POST' }); } catch {}
  library.scanning = false;
  await loadLibrary(true);
}

export async function fetchSong(id) {
  const r = await fetch(`/library/song?id=${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(r.status === 404 ? 'This song is no longer in the library' : `song: ${r.status}`);
  return r.json();
}

const call = async (url, init) => {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({ error: `failed (${r.status})` }));
  if (!r.ok) throw new Error(j.error || 'failed');
  return j;
};
export const findSongTab = (id) => call(`/library/tab/find?id=${encodeURIComponent(id)}`, { method: 'POST' });
export const removeSongTab = (id) => call(`/library/tab/remove?id=${encodeURIComponent(id)}`, { method: 'POST' });
export const uploadSongTab = (id, file) => call(`/library/tab/upload?id=${encodeURIComponent(id)}&name=${encodeURIComponent(file.name)}`,
  { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });

export const artUrl = (s) => `/library/art?id=${encodeURIComponent(s.id)}&v=${s.mtime || 0}`;

// ---------- instruments ----------
// Shown in this order; `short` for list rows. Colours follow the instrument (not the frets).
export const INSTRUMENTS = [
  { key: 'guitar', label: 'Guitar', short: 'GTR', color: '#f39a2a', icon: 'guitar' },
  { key: 'rhythm', label: 'Rhythm', short: 'RHY', color: '#e0b04a', icon: 'guitar' },
  { key: 'coop', label: 'Co-op guitar', short: 'COOP', color: '#d9a066', icon: 'guitar' },
  { key: 'bass', label: 'Bass', short: 'BASS', color: '#3a8df0', icon: 'bass' },
  { key: 'drums', label: 'Drums', short: 'DRM', color: '#e5413b', icon: 'drums' },
  { key: 'keys', label: 'Keys', short: 'KEYS', color: '#f2d02c', icon: 'keys' },
  { key: 'vocals', label: 'Vocals', short: 'VOX', color: '#b48cff', icon: 'mic' },
  { key: 'harmonies', label: 'Harmonies', short: 'HARM', color: '#d08cff', icon: 'mic' },
  { key: 'proGuitar', label: 'Pro Guitar', short: 'PRO G', color: '#f39a2a', icon: 'guitar', pro: true },
  { key: 'proBass', label: 'Pro Bass', short: 'PRO B', color: '#3a8df0', icon: 'bass', pro: true },
  { key: 'proDrums', label: 'Pro Drums', short: 'PRO D', color: '#e5413b', icon: 'drums', pro: true },
  { key: 'proKeys', label: 'Pro Keys', short: 'PRO K', color: '#f2d02c', icon: 'keys', pro: true },
  { key: 'ghl', label: '6-fret Guitar', short: '6F', color: '#9aa3ad', icon: 'guitar' },
  { key: 'ghlBass', label: '6-fret Bass', short: '6F B', color: '#9aa3ad', icon: 'bass' },
];
// The instruments to show in a list row: the main ones, pro marked on top of its base part.
export const ROW_PARTS = ['guitar', 'bass', 'drums', 'keys', 'vocals'];
// Difficulty tier (0–6, as YARG rates songs) in words
export const TIER = ['Warm-up', 'Beginner', 'Intermediate', 'Advanced', 'Expert', 'Expert+', 'Brutal'];

export const fmtLength = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
