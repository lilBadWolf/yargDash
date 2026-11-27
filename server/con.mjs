// Rock Band packages: Xbox 360 STFS files (CON / LIVE, e.g. "*_rb3con", often with no extension), as YARG reads them
// (YARG.Core IO/ConHandler, Song/Entries/RBCON). One package holds one or more songs:
//
//   songs/songs.dta                       every song's metadata (a Lisp-like text file, see parseDta)
//   songs/<name>/<name>.mid               the chart (same MIDI format as a notes.mid)
//   songs/<name>/<name>.mogg              the audio: one multichannel Ogg Vorbis, after a small header
//   songs/<name>/gen/<name>_keep.png_xbox album art (a DXT texture, see conArt)
//
// Only unencrypted moggs (version 0x0A: customs) can be played; Harmonix's own DLC is encrypted.
//
// Exports isCon(file), conSongs(file) -> [{ node, meta, files: { mid, mogg, art } }], conRead(file, name),
// conReadRange(file, name, start, end), conMogg(file, name) -> { start, size } | null, conArt(file, name) -> PNG Buffer
import fs from 'node:fs';
import zlib from 'node:zlib';

const FIRST_BLOCK = 0xc000, BLOCK = 0x1000, SECTION = 170, SQUARED = SECTION * SECTION;

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return n === len ? b : b.subarray(0, n);
}

export function isCon(file) {
  let fd;
  try { fd = fs.openSync(file, 'r'); const m = readAt(fd, 0, 4).toString('latin1'); return m === 'CON ' || m === 'LIVE' || m === 'PIRS'; }
  catch { return false; }
  finally { if (fd != null) fs.closeSync(fd); }
}

const blockAt = (n, shift) => {
  let adj = 0;
  if (n >= SECTION) {
    adj += (Math.floor(n / SECTION) + 1) << shift;
    if (n >= SQUARED) adj += (Math.floor(n / SQUARED) + 1) << shift;
  }
  return FIRST_BLOCK + (adj + n) * BLOCK;
};
const u24be = (b, o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
const u24le = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);

// The package's files: Map name -> { name, len, first, count, contiguous, dir }
function listings(fd) {
  const head = readAt(fd, 0, 0x380);
  const tag = head.toString('latin1', 0, 4);
  if (!['CON ', 'LIVE', 'PIRS'].includes(tag)) throw new Error('not a CON/LIVE package');
  const entryId = head.readInt32BE(0x340);
  const shift = (((entryId + 0xfff) & 0xf000) >> 12) !== 0xb ? 1 : 0;
  const tableLen = BLOCK * (head[0x37c] | (head[0x37d] << 8));
  const table = readAt(fd, blockAt(u24le(head, 0x37e), shift), tableLen);
  const list = [];
  for (let o = 0; o + 0x40 <= table.length && table[o] !== 0; o += 0x40) {
    const pathIndex = table.readInt16BE(o + 0x32);
    const root = pathIndex >= 0 && list[pathIndex] ? `${list[pathIndex].name}/` : '';
    list.push({
      name: root + table.toString('utf8', o, o + (table[o + 0x28] & 0x3f)),
      dir: !!(table[o + 0x28] & 0x80), contiguous: !!(table[o + 0x28] & 0x40),
      count: u24le(table, o + 0x29), first: u24le(table, o + 0x2f), len: table.readInt32BE(o + 0x34),
    });
  }
  // by lower-case name: some packages' folders aren't spelled the way their songs.dta spells them
  return { shift, files: new Map(list.filter((f) => !f.dir).map((f) => [f.name.toLowerCase(), f])) };
}

// Where each 4 KB block of a file is in the package (split files are chained through the hash tables)
function blocksOf(fd, f, shift) {
  const out = [];
  let n = f.first;
  for (let i = 0; i < f.count; i++) {
    const at = blockAt(f.contiguous ? f.first + i : n, shift);
    out.push(at);
    if (!f.contiguous && i + 1 < f.count) {
      const off = n % SECTION;
      const hash = readAt(fd, at - (off + 1) * BLOCK + off * 0x18 + 0x15, 3);
      n = u24be(hash, 0);
    }
  }
  return out;
}

// Parsed packages, by path (re-read when the file changes)
const cache = new Map();
function open(file) {
  const st = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return hit;
  const fd = fs.openSync(file, 'r');
  try {
    const { shift, files } = listings(fd);
    const pkg = { size: st.size, mtime: st.mtimeMs, shift, files, blocks: new Map() };
    cache.set(file, pkg);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    return pkg;
  } finally { fs.closeSync(fd); }
}

// Bytes [start, end] of a file in the package
export function conReadRange(file, name, start, end) {
  const pkg = open(file);
  const f = pkg.files.get(name.toLowerCase());
  if (!f) throw new Error(`${name} isn't in the package`);
  end = Math.min(end, f.len - 1);
  if (end < start) return Buffer.alloc(0);
  const fd = fs.openSync(file, 'r');
  try {
    let blocks = pkg.blocks.get(f);
    if (!blocks) { blocks = blocksOf(fd, f, pkg.shift); pkg.blocks.set(f, blocks); }
    const out = Buffer.alloc(end - start + 1);
    let o = 0, pos = start;
    while (pos <= end) {
      const i = Math.floor(pos / BLOCK), within = pos % BLOCK;
      // read runs of blocks that sit next to each other in one go
      let j = i;
      while (j + 1 < blocks.length && blocks[j + 1] === blocks[j] + BLOCK && (j + 1) * BLOCK <= end) j++;
      const len = Math.min(end - pos + 1, (j - i + 1) * BLOCK - within);
      fs.readSync(fd, out, o, len, blocks[i] + within);
      o += len; pos += len;
    }
    return out;
  } finally { fs.closeSync(fd); }
}
export const conRead = (file, name) => conReadRange(file, name, 0, Number.MAX_SAFE_INTEGER);

// ---------------------------------------------------------------------------
// songs.dta: ( 'node' ( key value… ) ( key ( key value… ) ) … ) per song
// ---------------------------------------------------------------------------
function dtaTokens(text) {
  const out = [];
  const re = /\s+|;[^\n]*|"((?:[^"\\]|\\.)*)"|'([^']*)'|([()[\]{}])|([^\s()[\]{}"';]+)/gy;
  let m;
  while (re.lastIndex < text.length && (m = re.exec(text))) {
    if (m[1] != null) out.push({ s: m[1].replace(/\\(.)/g, (_, c) => (c === 'q' ? '"' : c === 'n' ? '\n' : c)) });
    else if (m[2] != null) out.push({ a: m[2] });
    else if (m[3]) out.push(m[3]);
    else if (m[4] != null) out.push({ a: m[4] });
  }
  return out;
}
function dtaTree(tokens) {
  let i = 0;
  const list = () => {
    const items = [];
    while (i < tokens.length) {
      const t = tokens[i++];
      if (t === '(' || t === '[' || t === '{') items.push(list());
      else if (t === ')' || t === ']' || t === '}') return items;
      else items.push(t.s != null ? t.s : /^-?\d+(\.\d+)?$/.test(t.a) ? Number(t.a) : t.a);
    }
    return items;
  };
  return list();
}
// (key value) lists -> object; nested lists become objects too (a value list stays an array)
const isPairList = (l) => Array.isArray(l) && l.length && l.every((x) => Array.isArray(x) && typeof x[0] === 'string');
function dtaObj(items) {
  const o = {};
  for (const it of items) {
    if (!Array.isArray(it) || typeof it[0] !== 'string') continue;
    const rest = it.slice(1);
    o[it[0]] = rest.length === 1 ? (isPairList(rest[0]) ? dtaObj(rest[0]) : rest[0]) : isPairList(rest) ? dtaObj(rest) : rest;
  }
  return o;
}
export function parseDta(buf) {
  const latin = buf.toString('latin1');
  const text = /\(\s*'?encoding'?\s+'?utf8'?\s*\)/i.test(latin) ? buf.toString('utf8') : latin;
  return dtaTree(dtaTokens(text)).filter((x) => Array.isArray(x) && typeof x[0] === 'string').map((x) => ({ node: x[0], dta: dtaObj(x.slice(1)) }));
}

// Rock Band rank points -> difficulty tier 0–6 (YARG.Core RBCONEntry diff maps)
const TIERS = {
  guitar: [139, 176, 221, 267, 333, 409], bass: [135, 181, 228, 293, 364, 436], drum: [124, 151, 178, 242, 345, 448],
  keys: [153, 211, 269, 327, 385, 443], vocals: [132, 175, 218, 279, 353, 427], real_guitar: [150, 205, 264, 323, 382, 442],
  real_bass: [150, 208, 267, 325, 384, 442], real_keys: [153, 211, 269, 327, 385, 443], vocal_harm: [132, 175, 218, 279, 353, 427],
};
const RANK_ALIAS = { drums: 'drum', realGuitar: 'real_guitar', realBass: 'real_bass', realKeys: 'real_keys', harmVocals: 'vocal_harm' };
const DIFF_KEY = { guitar: 'diff_guitar', bass: 'diff_bass', drum: 'diff_drums', keys: 'diff_keys', vocals: 'diff_vocals', real_guitar: 'diff_guitar_real',
  real_bass: 'diff_bass_real', real_keys: 'diff_keys_real', vocal_harm: 'diff_vocals_harm', rhythm: 'diff_rhythm' };
const tier = (rank, map) => { let i = 0; while (i < 6 && map[i] <= rank) i++; return i; };
const tuning = (v) => (Array.isArray(v) ? v.join(' ') : v);

// A song's .dta as song.ini-style metadata (the keys library.mjs and yarg.mjs read)
function metaOf(dta) {
  const meta = { name: dta.name, artist: dta.artist, album: dta.album_name, genre: dta.genre, charter: dta.author,
    year: dta.year_released ?? (typeof dta.date_released === 'string' ? dta.date_released.slice(0, 4) : undefined),
    song_length: dta.song_length, loading_phrase: dta.loading_phrase, delay: 0 };
  for (const [k, v] of Object.entries(dta.rank && typeof dta.rank === 'object' ? dta.rank : {})) {
    const key = RANK_ALIAS[k] || k;
    if (DIFF_KEY[key] && Number(v) > 0) meta[DIFF_KEY[key]] = tier(Number(v), TIERS[key] || TIERS.guitar);
  }
  if (meta.diff_drums != null && meta.diff_drums_real == null) meta.pro_drums = 'True'; // RB drum charts are Pro Drums
  if (meta.diff_drums != null) meta.diff_drums_real = meta.diff_drums;
  if (dta.real_guitar_tuning != null) meta.real_guitar_tuning = tuning(dta.real_guitar_tuning);
  if (dta.real_bass_tuning != null) meta.real_bass_tuning = tuning(dta.real_bass_tuning);
  for (const k of Object.keys(meta)) if (meta[k] == null) delete meta[k]; else meta[k] = String(meta[k]);
  return meta;
}

// The songs in a package: [{ node, meta, files: { mid, mogg, art }, tracks: { drum: [0,1], …, crowd }, channels }]
export function conSongs(file) {
  const pkg = open(file);
  if (pkg.songs) return pkg.songs;
  const dtaName = [...pkg.files.keys()].find((n) => /(^|\/)songs\.dta$/i.test(n));
  if (!dtaName) throw new Error('no songs.dta in the package');
  const songs = [];
  for (const { node, dta } of parseDta(conRead(file, dtaName))) {
    const loc = String(dta.song?.name || `songs/${node}/${node}`);
    const sub = loc.split('/').pop();
    const dir = loc.slice(0, loc.length - sub.length);
    const files = { mid: `${loc}.mid`, mogg: `${loc}.mogg`, art: `${dir}gen/${sub}_keep.png_xbox` };
    for (const k of Object.keys(files)) if (!pkg.files.has(files[k].toLowerCase())) delete files[k];
    if (!files.mid || !dta.name) continue;
    const tracks = {};
    const tr = dta.song?.tracks;
    if (tr && typeof tr === 'object') for (const [k, v] of Object.entries(tr)) tracks[k] = (Array.isArray(v) ? v : [v]).filter(Number.isInteger);
    if (dta.song?.crowd_channels) tracks.crowd = [].concat(dta.song.crowd_channels).filter(Number.isInteger);
    const channels = Array.isArray(dta.song?.pans) ? dta.song.pans.length : 0;
    songs.push({ node, meta: metaOf(dta), files, tracks, channels, pans: dta.song?.pans || [], vols: dta.song?.vols || [] });
  }
  pkg.songs = songs;
  return songs;
}

// The Ogg stream inside a mogg: { start, size } (null: encrypted, can't be played)
export function conMogg(file, name) {
  const pkg = open(file);
  const f = pkg.files.get(name.toLowerCase());
  if (!f) return null;
  const head = conReadRange(file, name, 0, 7);
  if (head.readInt32LE(0) !== 0x0a) return null;
  const start = head.readInt32LE(4);
  if (conReadRange(file, name, start, start + 3).toString('latin1') !== 'OggS') return null;
  return { start, size: f.len - start };
}

// ---------------------------------------------------------------------------
// album art: an Xbox DXT1/DXT5 texture (16-bit words byte-swapped) after a 32-byte header -> PNG
// ---------------------------------------------------------------------------
const c565 = (v) => [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31];
function decodeDxt(data, w, h, dxt5) {
  const px = Buffer.alloc(w * h * 4);
  const bs = dxt5 ? 16 : 8;
  let o = 0;
  for (let by = 0; by < h; by += 4) {
    for (let bx = 0; bx < w; bx += 4, o += bs) {
      if (o + bs > data.length) return px;
      const c = dxt5 ? o + 8 : o;
      const a0 = c565(data.readUInt16LE(c)), a1 = c565(data.readUInt16LE(c + 2));
      const v0 = data.readUInt16LE(c), v1 = data.readUInt16LE(c + 2);
      const cols = [a0, a1];
      if (v0 > v1 || dxt5) { cols.push(a0.map((x, i) => (2 * x + a1[i]) / 3), a0.map((x, i) => (x + 2 * a1[i]) / 3)); }
      else { cols.push(a0.map((x, i) => (x + a1[i]) / 2), [0, 0, 0]); }
      const bits = data.readUInt32LE(c + 4);
      let alpha = null;
      if (dxt5) {
        const al0 = data[o], al1 = data[o + 1];
        const ab = data.readUIntLE(o + 2, 6);
        const at = [al0, al1];
        if (al0 > al1) for (let i = 1; i < 7; i++) at.push(((7 - i) * al0 + i * al1) / 7);
        else { for (let i = 1; i < 5; i++) at.push(((5 - i) * al0 + i * al1) / 5); at.push(0, 255); }
        alpha = (k) => at[Math.floor(ab / 2 ** (3 * k)) & 7];
      }
      for (let k = 0; k < 16; k++) {
        const x = bx + (k & 3), y = by + (k >> 2);
        if (x >= w || y >= h) continue;
        const col = cols[(bits >>> (2 * k)) & 3];
        const p = (y * w + x) * 4;
        px[p] = col[0]; px[p + 1] = col[1]; px[p + 2] = col[2];
        px[p + 3] = alpha ? alpha(k) : (!dxt5 && v0 <= v1 && ((bits >>> (2 * k)) & 3) === 3 ? 0 : 255);
      }
    }
  }
  return px;
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(px, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
export function conArt(file, name) {
  const b = conRead(file, name);
  if (b.length < 32) throw new Error('art too small');
  const dxt5 = !(b[1] === 0x04 && b.readInt32LE(2) === 0x08); // YARG.Core YARGImage.TransferDXT
  const w = b.readUInt16LE(7) || 256, h = b.readUInt16LE(9) || 256;
  const data = Buffer.from(b.subarray(32));
  for (let i = 0; i + 1 < data.length; i += 2) { const t = data[i]; data[i] = data[i + 1]; data[i + 1] = t; }
  return png(decodeDxt(data, w, h, dxt5), w, h);
}
