// YARG integration for the yargDash server: what song is playing, its lyrics, and where we are in it.
//
//  * Song:   YARG writes the song it's playing to <YARG data>/currentSong.json (blank outside gameplay).
//            Its ActualLocation points at the song folder or .sng file, which we read the lyrics from.
//  * Clock:  YARG's "UDP Data Stream" (Settings > All Settings > Experimental) broadcasts game state
//            ~88x/s on port 36107. It has no song position, but it does carry the pause state, the BPM
//            (0 until the song reaches its first tempo marker, i.e. song time 0) and a byte for every
//            beat line YARG passes. So: start the clock when BPM goes non-zero, freeze it while paused,
//            and snap it to the chart's bar lines whenever YARG reports a measure line.
//
//            (macOS: YARG's broadcast is blocked unless YARG is started with yarg/start-yarg.sh, i.e. `npm run yarg`.)
//  * Menu:   the song YARG plays in its menus (the file it has open) and when it started (its log), see below.
//  * Charts: lyrics for every vocal part with note pitches, sections, the beat grid, Pro Guitar/Bass parts and
//            the 5-fret parts' note times (for lining up Guitar Pro tabs, see tabs.mjs).
//  * Also:   BPM, pause state, whether YARG is running (the YARG tab only shows then), YARG's scores,
//            and claims (a device asking to do something once per play).
//
// Exports createYarg({ log, broadcast, getDir, tabs }) -> { snapshot(), lanes(), setDir(), claim(key), confirmMenu(on), close() }
// SSE messages: yarg {yarg: snapshot}, yargClock {clock}, yargBeat {k: 0 bar | 1 strong | 2 weak}

import dgram from 'node:dgram';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { midiLanes, chartLanes } from './lanes.mjs';

export const YARG_UDP_PORT = Number(process.env.LC_YARG_PORT) || 36107; // env override: for testing next to a running YARG

// ---------------------------------------------------------------------------
// where YARG keeps currentSong.json (Unity's persistentDataPath + /release or /nightly)
// ---------------------------------------------------------------------------
export function defaultYargDirs() {
  const home = os.homedir();
  const roots = process.platform === 'darwin'
    ? [path.join(home, 'Library', 'Application Support', 'in.yarg.game'), path.join(home, 'Library', 'Application Support', 'YARC', 'YARG')]
    : process.platform === 'win32'
      ? [path.join(home, 'AppData', 'LocalLow', 'YARC', 'YARG')]
      : [path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'unity3d', 'YARC', 'YARG')];
  return roots.flatMap((r) => ['release', 'nightly'].map((b) => path.join(r, b)));
}

// ---------------------------------------------------------------------------
// .sng container (https://github.com/mdsitton/SngFileFormat): read just the file we need
// ---------------------------------------------------------------------------
function readSngFiles(file, wanted) {
  const fd = fs.openSync(file, 'r');
  try {
    const rd = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b; };
    const head = rd(0, 26);
    if (head.toString('latin1', 0, 6) !== 'SNGPKG') throw new Error('not an .sng file');
    const mask = head.subarray(10, 26);
    let pos = 26;
    pos += 8 + Number(rd(pos, 8).readBigUInt64LE()); // skip metadata section
    const idxLen = Number(rd(pos, 8).readBigUInt64LE());
    const idx = rd(pos + 8, idxLen);
    const count = Number(idx.readBigUInt64LE(0));
    const files = new Map();
    let o = 8;
    for (let i = 0; i < count; i++) {
      const n = idx[o]; const name = idx.toString('utf8', o + 1, o + 1 + n); o += 1 + n;
      const len = Number(idx.readBigUInt64LE(o)); const at = Number(idx.readBigUInt64LE(o + 8)); o += 16;
      if (!wanted.includes(name.toLowerCase())) continue;
      const data = rd(at, len);
      for (let j = 0; j < data.length; j++) data[j] ^= mask[j & 15] ^ (j & 0xff);
      files.set(name.toLowerCase(), data);
    }
    return files;
  } finally { fs.closeSync(fd); }
}

// ---------------------------------------------------------------------------
// tempo map: ticks -> seconds
// ---------------------------------------------------------------------------
function tempoMap(res, tempos /* [{tick, usPerQ}] sorted */) {
  const segs = [];
  let sec = 0, last = { tick: 0, usPerQ: 500000 };
  for (const t of tempos) {
    if (t.tick > last.tick) sec += ((t.tick - last.tick) / res) * (last.usPerQ / 1e6);
    if (t.tick === last.tick && segs.length) segs.pop();
    last = t;
    segs.push({ tick: t.tick, sec, usPerQ: t.usPerQ });
  }
  if (!segs.length || segs[0].tick > 0) segs.unshift({ tick: 0, sec: 0, usPerQ: 500000 });
  return (tick) => {
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].tick <= tick) lo = m; else hi = m - 1; }
    const s = segs[lo];
    return s.sec + ((tick - s.tick) / res) * (s.usPerQ / 1e6);
  };
}

// Beat grid from time signatures ([{tick, num, den}]) up to endTick: [{tick, k}] with k 0 = bar line, 1 = beat.
function beatTicks(res, sigs, endTick) {
  const list = sigs.length && sigs[0].tick === 0 ? sigs : [{ tick: 0, num: 4, den: 4 }, ...sigs];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const { tick, num, den } = list[i];
    const stop = i + 1 < list.length ? list[i + 1].tick : endTick;
    const step = Math.max(1, Math.round((res * 4) / den));
    for (let t = tick, n = 0; t < stop; t += step, n++) out.push({ tick: t, k: n % Math.max(1, num) === 0 ? 0 : 1 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// lyric text clean-up (mirrors YARG.Core's LyricSymbols for the lyrics display)
// ---------------------------------------------------------------------------
const TRAILING_FLAGS = new Set(['-', '=', '+', '#', '^', '*', '%', '/', '$']);
function cleanLyric(raw) {
  let s = raw.replace(/<[^>]*>/g, '');
  let join = false, hyphen = false, talky = false;
  let end = s.length;
  while (end > 0 && TRAILING_FLAGS.has(s[end - 1])) {
    if (s[end - 1] === '-') join = true;
    if (s[end - 1] === '=') hyphen = true;
    if ('#^*'.includes(s[end - 1])) talky = true;
    end--;
  }
  s = s.slice(0, end).replace(/^\$/, '').replace(/[+#^*%/$"]/g, '').replace(/=/g, '-').replace(/[§_]/g, ' ');
  if (hyphen) { s += '-'; join = true; }
  return { text: s, join, talky };
}

// Group timed syllables into phrases. markers = [{s, e}] (phrase spans) or null (split on gaps).
function buildPhrases(syls, markers) {
  syls.sort((a, b) => a.t - b.t);
  const phrases = [];
  if (markers?.length) {
    markers.sort((a, b) => a.s - b.s);
    let i = 0;
    for (const m of markers) {
      const p = { s: m.s, e: m.e, syl: [] };
      while (i < syls.length && syls[i].t < m.s - 0.001) i++; // stray syllables outside phrases are dropped
      while (i < syls.length && syls[i].t < m.e - 0.001) p.syl.push(syls[i++]);
      if (p.syl.length) phrases.push(p);
    }
  } else {
    let p = null;
    for (const y of syls) {
      if (!p || y.t - p.e > 2.5 || p.syl.length >= 12) phrases.push((p = { s: y.t, e: y.t, syl: [] }));
      p.syl.push(y); p.e = y.t + 0.4;
    }
  }
  for (const p of phrases) {
    p.syl = p.syl.map(({ t, x, j }) => ({ t: Math.round(t * 1000) / 1000, x, j }));
    p.s = Math.round(p.s * 1000) / 1000; p.e = Math.round(p.e * 1000) / 1000;
  }
  return phrases.filter((p) => p.syl.some((y) => y.x.trim()));
}

const prettySection = (s) => s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------
// notes.mid
// ---------------------------------------------------------------------------
function decodeText(b) {
  const u = b.toString('utf8');
  return u.includes('�') ? b.toString('latin1') : u;
}

function parseMidi(buf) {
  if (buf.toString('latin1', 0, 4) !== 'MThd') throw new Error('not a MIDI file');
  const res = buf.readUInt16BE(12);
  if (res & 0x8000) throw new Error('SMPTE timing not supported');
  let pos = 8 + buf.readUInt32BE(4);
  const tracks = [];
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4), len = buf.readUInt32BE(pos + 4);
    const end = pos + 8 + len;
    if (id === 'MTrk') {
      const tr = { name: '', events: [] };
      let p = pos + 8, tick = 0, status = 0;
      const vlq = () => { let v = 0, c; do { c = buf[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80 && p < end); return v; };
      while (p < end) {
        tick += vlq();
        const b = buf[p];
        if (b === 0xff) { // meta (never part of running status)
          p++;
          const type = buf[p++]; const l = vlq(); const data = buf.subarray(p, p + l); p += l;
          if (type === 0x03 && !tr.name) tr.name = decodeText(data).trim();
          if (type === 0x2f) break;
          tr.events.push({ tick, meta: type, data });
        } else if (b === 0xf0 || b === 0xf7) { // sysex: kept apart (Phase Shift open/tap markers, see lanes.mjs)
          p++; const l = vlq();
          (tr.sysex ||= []).push({ tick, data: buf.subarray(p, p + l) }); p += l;
        } else {
          if (b & 0x80) { status = b; p++; } // else: running status
          if (!status) { p++; continue; }
          const hi = status & 0xf0;
          const d1 = buf[p++], d2 = hi === 0xc0 || hi === 0xd0 ? 0 : buf[p++];
          if (hi === 0x90 || hi === 0x80) tr.events.push({ tick, on: hi === 0x90 && d2 > 0, note: d1, vel: d2, ch: status & 15 });
          if (hi === 0x90 && d2 > 0) tr.lastNote = tick;
        }
      }
      tracks.push(tr);
    }
    pos = end;
  }

  const tempos = [], sigs = [];
  let lastTick = 0;
  for (const tr of tracks) for (const e of tr.events) {
    if (e.note !== undefined || (e.meta === 0x01 || e.meta === 0x05)) lastTick = Math.max(lastTick, e.tick);
    if (e.meta === 0x51 && e.data.length >= 3) tempos.push({ tick: e.tick, usPerQ: e.data.readUIntBE(0, 3) });
    if (e.meta === 0x58 && e.data.length >= 2) sigs.push({ tick: e.tick, num: e.data[0], den: 2 ** e.data[1] });
  }
  tempos.sort((a, b) => a.tick - b.tick); sigs.sort((a, b) => a.tick - b.tick);
  const sec = tempoMap(res, tempos);

  // Vocal parts: lead (PART VOCALS) and harmonies (HARM1-3). Harmony parts without their own phrase markers
  // use HARM2's (HARM3, Rock Band convention) or HARM1's.
  const byName = (n) => tracks.find((t) => t.name === n);
  const parts = {};
  for (const [key, name] of [['vocals', 'PART VOCALS'], ['harm1', 'HARM1'], ['harm2', 'HARM2'], ['harm3', 'HARM3']]) {
    const tr = byName(name);
    if (!tr) continue;
    let markers = phraseMarkers(tr, sec);
    if (!markers.length && key === 'harm3') markers = phraseMarkers(byName('HARM2'), sec);
    if (!markers.length && key.startsWith('harm')) markers = phraseMarkers(byName('HARM1'), sec);
    const part = vocalPart(tr, markers, sec);
    if (part.phrases.length) parts[key] = part;
  }

  const sections = [];
  const events = tracks.find((t) => t.name === 'EVENTS');
  for (const e of events?.events || []) {
    if (e.meta !== 0x01) continue;
    const m = decodeText(e.data).trim().match(/^\[(?:section|prc)[ _](.+)\]$/i);
    if (m) sections.push({ t: Math.round(sec(e.tick) * 1000) / 1000, name: prettySection(m[1]) });
  }

  // Beat grid: the BEAT track (12 = bar line, 13 = beat) if the chart has one, else time signatures
  const beatTr = byName('BEAT');
  let beats = beatTr ? beatTr.events.filter((e) => e.on && (e.note === 12 || e.note === 13)).map((e) => ({ tick: e.tick, k: e.note === 12 ? 0 : 1 })) : [];
  if (beats.filter((b) => b.k === 0).length < 4) beats = beatTicks(res, sigs, lastTick);
  // For tabs: Pro Guitar/Bass parts (real strings and frets), and the 5-fret parts' note times (to line up Guitar Pro files)
  const pro = {};
  for (const [key, names] of [['guitar', ['PART REAL_GUITAR', 'PART REAL_GUITAR_22']], ['bass', ['PART REAL_BASS', 'PART REAL_BASS_22']]]) {
    const tr = names.map(byName).find((t) => t?.events.some((e) => e.on && e.note >= 96 && e.note <= 101));
    if (tr) pro[key] = proPart(tr, sec);
  }
  const onsets = {};
  for (const [key, name] of [['guitar', 'PART GUITAR'], ['bass', 'PART BASS']]) {
    const tr = byName(name);
    if (tr) onsets[key] = [...new Set(tr.events.filter((e) => e.on && e.note >= 96 && e.note <= 100).map((e) => e.tick))].sort((a, b) => a - b).map((t) => Math.round(sec(t) * 1000) / 1000);
  }
  return { parts, sections, beats: beats.map((b) => [Math.round(sec(b.tick) * 10000) / 10000, b.k]), pro, onsets, lanes: midiLanes(tracks, res, sec, decodeText) };
}

// Rock Band 3 Pro Guitar/Bass, expert: notes 96-101 = strings low E..high e, velocity - 100 = fret,
// channel = note type (1 ghost, 2 bend, 3 muted, 5/6 harmonic); 102 = hammer-on/pull-off, 103 = slide; "[chrd3 X]" = chord name.
// Notes: [time, duration, string (0 = lowest), fret, flags]
export const TAB = { MUTED: 1, GHOST: 2, BEND: 4, HARMONIC: 8, HAMMER: 16, SLIDE: 32, TIE: 64, PALM: 128, TAP: 256 };
function proPart(tr, sec) {
  const open = {}, notes = [], hopo = [], slide = [], chords = [];
  const r3 = (x) => Math.round(x * 1000) / 1000;
  for (const e of tr.events) {
    if (e.meta === 0x01) {
      const m = decodeText(e.data).match(/^\[chrd3 (.+)\]$/);
      if (m && m[1].trim()) chords.push([r3(sec(e.tick)), m[1].trim()]);
      continue;
    }
    if (e.note === 102 || e.note === 103) { (e.note === 102 ? hopo : slide).push([e.tick, e.on]); continue; }
    if (e.note < 96 || e.note > 101) continue;
    const s = e.note - 96;
    if (e.on) open[s] = e;
    else if (open[s]) {
      const on = open[s]; delete open[s];
      const flags = (on.ch === 3 ? TAB.MUTED : 0) | (on.ch === 1 ? TAB.GHOST : 0) | (on.ch === 2 ? TAB.BEND : 0) | (on.ch === 5 || on.ch === 6 ? TAB.HARMONIC : 0);
      notes.push({ tick: on.tick, end: e.tick, s, fret: Math.max(0, on.vel - 100), flags });
    }
  }
  // marker notes (102/103) span the notes they apply to
  const spans = (list) => { const out = []; let st = null; for (const [t, on] of list) { if (on && st === null) st = t; else if (!on && st !== null) { out.push([st, t]); st = null; } } return out; };
  const inSpan = (list, t) => list.some(([a, b]) => t >= a && t < b);
  const hs = spans(hopo), ss = spans(slide);
  notes.sort((a, b) => a.tick - b.tick || a.s - b.s);
  return {
    notes: notes.map((n) => [r3(sec(n.tick)), r3(sec(n.end) - sec(n.tick)), n.s, n.fret, n.flags | (inSpan(hs, n.tick) ? TAB.HAMMER : 0) | (inSpan(ss, n.tick) ? TAB.SLIDE : 0)]),
    chords,
  };
}

// Phrase spans from a vocal track's 105/106 notes (overlapping duet phrases merged).
function phraseMarkers(tr, sec) {
  if (!tr) return [];
  const markers = [];
  let on = null;
  for (const e of tr.events) {
    if (e.note !== 105 && e.note !== 106) continue;
    if (e.on && on === null) on = e.tick;
    else if (!e.on && on !== null) { markers.push({ s: sec(on), e: sec(e.tick) }); on = null; }
  }
  markers.sort((a, b) => a.s - b.s);
  const merged = [];
  for (const m of markers) {
    const prev = merged[merged.length - 1];
    if (prev && m.s < prev.e - 0.001) prev.e = Math.max(prev.e, m.e); else merged.push({ ...m });
  }
  return merged;
}

// One vocal part: lyric phrases, and the sung notes ([start, end, midi pitch, 1 = spoken/non-pitched]) for the pitch guide.
function vocalPart(tr, markers, sec) {
  const syls = [], notes = [], talkyTicks = new Set(), open = {};
  // Lyrics are lyric meta events, but some charts use text events for some or all of them.
  const seen = new Set();
  for (const e of tr.events) {
    if (e.meta === 0x05 || e.meta === 0x01) {
      const raw = decodeText(e.data).trim();
      if (!raw || raw.startsWith('[')) continue;
      const { text, join, talky } = cleanLyric(raw);
      if (talky) talkyTicks.add(e.tick);
      if (!text) { if (/^(\+-|-\+)$/.test(raw) && syls.length) syls[syls.length - 1].j = true; continue; } // slide-only note
      const key = `${e.tick}|${raw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      syls.push({ t: sec(e.tick), x: text, j: join });
    } else if (e.note >= 36 && e.note <= 84) {
      if (e.on) open[e.note] = e.tick;
      else if (open[e.note] !== undefined) {
        const on = open[e.note]; delete open[e.note];
        notes.push([Math.round(sec(on) * 1000) / 1000, Math.round(sec(e.tick) * 1000) / 1000, e.note, talkyTicks.has(on) ? 1 : 0]);
      }
    }
  }
  notes.sort((a, b) => a[0] - b[0]);
  return { phrases: buildPhrases(syls, markers), notes };
}

// ---------------------------------------------------------------------------
// notes.chart
// ---------------------------------------------------------------------------
function parseChart(text) {
  const sections = {};
  let cur = null;
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const l = line.trim();
    const h = l.match(/^\[(.+)\]$/);
    if (h) { cur = sections[h[1]] = []; continue; }
    if (cur && l && l !== '{' && l !== '}') cur.push(l);
  }
  let res = 192;
  for (const l of sections.Song || []) { const m = l.match(/^Resolution\s*=\s*(\d+)/); if (m) res = +m[1]; }
  const tempos = [], sigs = [];
  let lastTick = 0;
  for (const l of sections.SyncTrack || []) {
    const m = l.match(/^(\d+)\s*=\s*(B|TS)\s+(\d+)(?:\s+(\d+))?/);
    if (!m) continue;
    if (m[2] === 'B') tempos.push({ tick: +m[1], usPerQ: 60e9 / +m[3] });
    else sigs.push({ tick: +m[1], num: +m[3], den: 2 ** (m[4] !== undefined ? +m[4] : 2) });
  }
  tempos.sort((a, b) => a.tick - b.tick); sigs.sort((a, b) => a.tick - b.tick);
  const sec = tempoMap(res, tempos);
  const syls = [], markers = [], secs = [];
  let open = null;
  for (const l of sections.Events || []) {
    const m = l.match(/^(\d+)\s*=\s*E\s+"?(.*?)"?$/);
    if (!m) continue;
    const tick = +m[1], ev = m[2];
    if (ev.startsWith('lyric ')) {
      const raw = ev.slice(6).trim();
      const { text, join } = cleanLyric(raw);
      if (text) syls.push({ t: sec(tick), x: text, j: join });
      else if (/^(\+-|-\+)$/.test(raw) && syls.length) syls[syls.length - 1].j = true;
    } else if (ev === 'phrase_start') {
      if (open !== null) markers.push({ s: sec(open), e: sec(tick) });
      open = tick;
    } else if (ev === 'phrase_end') {
      if (open !== null) { markers.push({ s: sec(open), e: sec(tick) }); open = null; }
    } else {
      const s = ev.match(/^section\s+(.+)$/i);
      if (s) secs.push({ t: Math.round(sec(tick) * 1000) / 1000, name: prettySection(s[1]) });
    }
  }
  if (open !== null) markers.push({ s: sec(open), e: Infinity });
  for (const k of Object.keys(sections)) for (const l of sections[k]) { const m = l.match(/^(\d+)\s*=/); if (m) lastTick = Math.max(lastTick, +m[1]); }
  const phrases = buildPhrases(syls, markers.length ? markers : null).map((p) => (p.e === Infinity ? { ...p, e: p.syl[p.syl.length - 1].t + 1 } : p));
  const onsets = {};
  for (const [key, name] of [['guitar', 'ExpertSingle'], ['bass', 'ExpertDoubleBass']]) {
    const ticks = new Set();
    for (const l of sections[name] || []) { const m = l.match(/^(\d+)\s*=\s*N\s+(\d+)/); if (m && (+m[2] <= 4 || +m[2] === 7)) ticks.add(+m[1]); }
    if (ticks.size) onsets[key] = [...ticks].sort((a, b) => a - b).map((t) => Math.round(sec(t) * 1000) / 1000);
  }
  return {
    parts: phrases.length ? { vocals: { phrases, notes: [] } } : {}, // .chart vocals have no pitches
    sections: secs,
    beats: beatTicks(res, sigs, lastTick).map((b) => [Math.round(sec(b.tick) * 10000) / 10000, b.k]),
    pro: {},
    onsets,
    lanes: chartLanes(sections, res, sec),
  };
}

// Vocal parts (lyrics + notes), section names and the beat grid for a song folder or .sng file.
export function loadLyrics(location) {
  const want = ['notes.mid', 'notes.midi', 'notes.chart'];
  let files;
  if (/\.sng$/i.test(location)) files = readSngFiles(location, want);
  else {
    files = new Map();
    for (const f of fs.readdirSync(location)) if (want.includes(f.toLowerCase())) files.set(f.toLowerCase(), fs.readFileSync(path.join(location, f)));
  }
  const mid = files.get('notes.mid') || files.get('notes.midi');
  const chart = files.get('notes.chart');
  if (!mid && !chart) throw new Error('no notes.mid or notes.chart found');
  const out = mid ? parseMidi(mid) : parseChart(chart.toString('utf8'));
  // a stray event far past the end of a chart shouldn't produce hours of bar lines
  const end = Math.max(0, ...Object.values(out.parts).flatMap((pt) => pt.phrases.map((p) => p.e)), ...out.sections.map((x) => x.t)) + 120;
  out.beats = out.beats.filter(([t]) => t <= end);
  out.measures = out.beats.filter(([, k]) => k === 0).map(([t]) => t);
  try { out.tunings = proTunings(songMetadata(location)); } catch { out.tunings = {}; }
  return out;
}

// A song's metadata: the .sng metadata section or song.ini, keys lower-cased.
export function songMetadata(location) {
  const meta = {};
  if (/\.sng$/i.test(location)) {
    const fd = fs.openSync(location, 'r');
    try {
      const head = Buffer.alloc(34); fs.readSync(fd, head, 0, 34, 0);
      if (head.toString('latin1', 0, 6) !== 'SNGPKG') throw new Error('not an .sng file');
      const len = Number(head.readBigUInt64LE(26));
      const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, 34);
      const n = Number(b.readBigUInt64LE(0));
      let o = 8;
      for (let i = 0; i < n && o < b.length; i++) {
        const kl = b.readInt32LE(o); const k = b.toString('utf8', o + 4, o + 4 + kl); o += 4 + kl;
        const vl = b.readInt32LE(o); const v = b.toString('utf8', o + 4, o + 4 + vl); o += 4 + vl;
        meta[k.toLowerCase()] = v;
      }
    } finally { fs.closeSync(fd); }
  } else {
    try {
      for (const line of fs.readFileSync(path.join(location, 'song.ini'), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([^=\[]+?)\s*=\s*(.*?)\s*$/);
        if (m) meta[m[1].toLowerCase()] = m[2];
      }
    } catch {}
  }
  return meta;
}

// Pro Guitar/Bass tuning from metadata ("real_guitar_tuning = -2 0 0 0 0 0": semitones from standard, low string first)
const STD_TUNING = { guitar: [40, 45, 50, 55, 59, 64], bass: [28, 33, 38, 43] };
export function proTunings(meta) {
  const out = {};
  for (const kind of ['guitar', 'bass']) {
    const raw = meta[`real_${kind}_tuning`] ?? meta[`real_${kind}_22_tuning`];
    if (raw == null) continue;
    const nums = String(raw).replace(/"[^"]*"/g, ' ').match(/-?\d+/g)?.map(Number) || [];
    const std = STD_TUNING[kind];
    if (nums.length >= std.length) out[kind] = std.map((m, i) => m + nums[i]);
  }
  return out;
}

// Name/artist/album/year of a song (.sng metadata or song.ini), for the menu music.
export function songInfo(location) {
  const meta = songMetadata(location);
  const strip = (s) => String(s ?? '').replace(/<[^>]*>/g, '');
  return { name: strip(meta.name) || path.basename(location).replace(/\.sng$/i, ''), artist: strip(meta.artist), album: strip(meta.album), year: strip(meta.year),
    length: (Number(meta.song_length) || 0) / 1000 };
}

// YARG.Core enums (InstrumentEnums.cs, StarAmount.cs)
const INSTRUMENT = { 0: 'Guitar', 1: 'Bass', 2: 'Rhythm', 3: 'Co-op guitar', 4: 'Keys', 10: '6-fret guitar', 11: '6-fret bass', 12: '6-fret rhythm',
  13: '6-fret co-op', 20: 'Drums', 21: 'Pro drums', 22: '5-lane drums', 23: 'Elite drums', 30: 'Pro guitar', 31: 'Pro guitar', 32: 'Pro bass',
  33: 'Pro bass', 34: 'Pro keys', 40: 'Vocals', 41: 'Harmonies', 42: 'Party vocals' };
// Dates are .NET ticks (sqlite-net) — too big for a JS number, so convert in SQL.
const REC_COLS = `Id, SongName, SongArtist, BandScore, BandStars, SongSpeed, HasBots,
  CASE WHEN Date > 100000000000000000 THEN Date / 10000 - 62135596800000 ELSE Date END AS DateMs`;
const DIFFICULTY = ['Beginner', 'Easy', 'Medium', 'Hard', 'Expert', 'Expert+'];
function recordWithPlayers(db, rec) {
  const players = db.prepare('SELECT s.Instrument, s.Difficulty, s.Score, s.Stars, s.NotesHit, s.NotesMissed, s.IsFc, s.Percent, p.Name AS PlayerName FROM PlayerScores s LEFT JOIN Players p ON p.Id = s.PlayerId WHERE s.GameRecordId = ? ORDER BY s.Id').all(rec.Id);
  return {
    date: Number(rec.DateMs) || 0, song: rec.SongName, artist: rec.SongArtist, score: Number(rec.BandScore) || 0, stars: Number(rec.BandStars) || 0, speed: rec.SongSpeed,
    bots: !!rec.HasBots,
    players: players.map((p) => ({ name: p.PlayerName || 'Player', instrument: INSTRUMENT[p.Instrument] ?? `#${p.Instrument}`, difficulty: DIFFICULTY[p.Difficulty] ?? '',
      score: Number(p.Score) || 0, stars: Number(p.Stars) || 0, percent: p.Percent, fc: !!p.IsFc, hit: p.NotesHit, missed: p.NotesMissed })),
  };
}

// ---------------------------------------------------------------------------
// live state
// ---------------------------------------------------------------------------
// Data stream datagram (YARG DataStreamController, BinaryWriter = little-endian):
// 0 uint32 'YARG'  4 version  5 platform  6 scene  7 paused  8 venue  9 float bpm  ... 38 beat
const SCENE = ['unknown', 'menu', 'gameplay', 'score', 'calibration', 'practice'];
const HALF_PACKET = 0.5 / 88; // packets are ~11 ms apart; on average we hear about an event this late

export function createYarg({ log, broadcast, getDir, tabs = null }) {
  let song = null;          // { name, artist, album, charter, year, length, location }
  let lyrics = null;        // { parts: { vocals|harm1|harm2|harm3: { phrases, notes } }, sections, beats } | { error }
  let measures = [];        // bar-line times, kept here for syncing
  let songLanes = null;     // every five-fret/drum part of the song, for the Lanes view (lanes.mjs); fetched, not broadcast
  let menuSong = null;      // what YARG plays in its menus: { name, artist, album, year }
  let results = null;       // { last: last finished song's scores, best: best band result for the current song }
  let play = 0;             // +1 every time a song (re)starts: lets devices act once per play
  const claims = new Set(); // "play:what" keys already handed to a device (see claim())
  let watchedFile = null, lastRaw = null;

  // ---------- clock ----------
  // songTime = t0 + (now - w0) * rate while running
  const clock = { state: 'off', t0: 0, w0: 0, rate: 1, menu: false }; // menu: following the menu music
  let stream = { live: false, at: 0, scene: 'unknown', paused: 0, bpm: 0 };
  let lastBar = null; // { t, w } last matched bar line, for measuring playback speed
  const wall = () => performance.now() / 1000;
  const songTime = (w = wall()) => (clock.state === 'run' ? clock.t0 + (w - clock.w0) * clock.rate : clock.t0);
  const clockMsg = () => ({ state: clock.state, t: Math.round(songTime() * 1000) / 1000, rate: clock.rate, stream: stream.live, scene: stream.scene, bpm: Math.round(stream.bpm), paused: stream.paused === 2, play, menu: clock.menu });
  const newPlay = () => { play++; claims.clear(); };
  const sendClock = () => broadcast({ type: 'yargClock', clock: clockMsg() });
  function setClock(state, t, w = wall()) {
    clock.state = state; clock.t0 = t; clock.w0 = w;
    sendClock();
  }

  function onPacket(b) {
    if (b.length < 39 || b.readUInt32LE(0) !== 0x59415247) return;
    const w = wall();
    const scene = SCENE[b[6]] || 'unknown', paused = b[7], bpm = b.readFloatLE(9), beat = b[38];
    const prev = stream;
    stream = { live: true, at: w, scene, paused, bpm };
    if (!prev.live) { log('YARG data stream: receiving'); setDetected(); sendClock(); }
    if (scene !== prev.scene) pollMenuSong();
    else if (scene !== prev.scene || Math.round(bpm) !== Math.round(prev.bpm) || (paused === 2) !== (prev.paused === 2)) sendClock();
    if (beat < 3 && (scene === 'gameplay' || scene === 'practice') && paused !== 2) broadcast({ type: 'yargBeat', k: beat });

    if (scene !== 'gameplay') {
      // practice starts mid-song and jumps around: no reliable anchor, so lyrics are shown unsynced
      if (clock.state !== 'off' && !clock.menu) { lastBar = null; setClock('off', 0); }
      return;
    }
    if (clock.menu) { clock.menu = false; clock.state = 'off'; }
    if (bpm === 0) { // chart (re)loaded, song time still < 0
      if (clock.state !== 'wait') { lastBar = null; newPlay(); setClock('wait', 0); } // keep rate: song speed usually stays the same
      return;
    }
    if (clock.state === 'wait' || clock.state === 'off') {
      // BPM is set the frame song time reaches the first tempo marker (time 0)
      lastBar = { t: 0, w: w - HALF_PACKET };
      setClock(paused === 2 ? 'pause' : 'run', paused === 2 ? 0 : HALF_PACKET * clock.rate, w);
      return;
    }
    if (paused === 2 && clock.state === 'run') { lastBar = null; setClock('pause', songTime(w), w); return; }
    if (paused !== 2 && clock.state === 'pause') { setClock('run', clock.t0, w); return; }

    // measure line: snap to the nearest bar line in the chart
    if (beat === 0 && clock.state === 'run' && measures.length) {
      const est = songTime(w);
      let lo = 0, hi = measures.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (measures[m] < est) lo = m + 1; else hi = m; }
      const cands = [measures[lo - 1], measures[lo]].filter((x) => x !== undefined);
      const bar = cands.reduce((a, c) => (Math.abs(c - est) < Math.abs(a - est) ? c : a));
      const i = measures.indexOf(bar);
      const gap = Math.min(...[measures[i + 1] - bar, bar - measures[i - 1]].filter((x) => x > 0)) || 2;
      if (Math.abs(bar - est) > gap * 0.4) return; // not a confident match: leave the clock alone
      const heardAt = w - HALF_PACKET;
      let rate = clock.rate;
      if (lastBar && bar > lastBar.t && heardAt - lastBar.w > 0.5) {
        const r = (bar - lastBar.t) / (heardAt - lastBar.w);
        if (r > 0.2 && r < 4) rate = Math.abs(r - clock.rate) > 0.08 ? r : clock.rate + (r - clock.rate) * 0.3; // song speed
        if (Math.abs(rate - 1) < 0.01) rate = 1;
      }
      lastBar = { t: bar, w: heardAt };
      const newT = bar + HALF_PACKET * rate;
      const drift = newT - est;
      clock.t0 = newT; clock.w0 = w;
      if (Math.abs(drift) > 0.015 || Math.abs(rate - clock.rate) > 0.004) { clock.rate = rate; sendClock(); }
      else clock.rate = rate;
    }
  }

  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('message', onPacket);
  sock.on('error', (e) => log('YARG data stream: cannot listen on UDP', YARG_UDP_PORT, '-', e.message));
  sock.bind(YARG_UDP_PORT);

  const liveTimer = setInterval(() => {
    if (stream.live && wall() - stream.at > 2) {
      stream.live = false;
      log('YARG data stream: stopped');
      if (!clock.menu) {
        if (clock.state === 'run') clock.t0 = songTime();
        clock.state = 'off';
      }
      setDetected();
      sendClock();
    }
  }, 1000);

  // ---------- is YARG running? ----------
  let running = false, detected = false, checkedOnce = false;
  function setDetected() {
    const d = running || stream.live || !!song;
    if (d !== detected) { detected = d; broadcast({ type: 'yarg', yarg: info() }); }
  }
  function checkProcess() {
    const done = (err, out) => {
      const was = running;
      running = !err && /\S/.test(out) && !/No tasks/i.test(out);
      setDetected();
      if (was && !running) pollMenuSong(); // clears the menu song
      if (!was && running && checkedOnce) launchFresh = true; // we saw YARG start: its first menu song starts from the top
      checkedOnce = true;
    };
    if (process.platform === 'win32') execFile('tasklist', ['/FI', 'IMAGENAME eq YARG.exe', '/NH'], { windowsHide: true }, done);
    else execFile('pgrep', ['-x', 'YARG'], done);
  }
  checkProcess();
  const procTimer = setInterval(checkProcess, 5000);

  // ---------- current song ----------
  function currentSongFile() {
    const dirs = getDir() ? [getDir()] : defaultYargDirs();
    let best = null;
    for (const d of dirs) {
      const f = path.join(d, 'currentSong.json');
      try { const st = fs.statSync(f); if (!best || st.mtimeMs > best.mtime) best = { f, mtime: st.mtimeMs }; } catch {}
    }
    return best?.f || path.join(dirs[0], 'currentSong.json');
  }

  function readSong() {
    let raw = '';
    try { raw = fs.readFileSync(watchedFile, 'utf8').trim(); } catch {}
    if (raw === lastRaw) return;
    lastRaw = raw;
    let entry = null;
    if (raw) { try { entry = JSON.parse(raw); } catch { lastRaw = null; return; } } // half-written: retry next poll
    if (!entry) {
      if (song) { song = null; lyrics = null; songLanes = null; measures = []; results = { ...results, best: null }; tabs?.setSong(null); broadcast({ type: 'yarg', yarg: info() }); setDetected(); pollMenuSong(); }
      return;
    }
    const strip = (s) => String(s ?? '').replace(/<[^>]*>/g, '');
    const next = { name: strip(entry.Name), artist: strip(entry.Artist), album: strip(entry.Album), charter: strip(entry.Charter),
      year: strip(entry.ParsedYear), length: (Number(entry.SongLengthMilliseconds) || 0) / 1000, location: entry.ActualLocation || '' };
    if (song && next.location === song.location && next.name === song.name) return;
    song = next;
    menuSong = null; menuPlay = null; menuLyrics = null;
    if (clock.menu) { clock.menu = false; clock.state = 'off'; }
    newPlay();
    try {
      if (!song.location) throw new Error('YARG did not say where the song is');
      const l = loadLyrics(song.location);
      measures = l.measures;
      lyrics = { parts: l.parts, sections: l.sections, beats: l.beats };
      songLanes = l.lanes || null;
      tabs?.setSong({ name: song.name, artist: song.artist }, l);
      const n = Object.entries(l.parts).map(([k, v]) => `${k} ${v.phrases.length}`).join(', ');
      log(`YARG: ${song.artist} - ${song.name} (${n || 'no vocals'})`);
    } catch (e) {
      measures = [];
      songLanes = null;
      lyrics = { error: e.message };
      tabs?.setSong({ name: song.name, artist: song.artist }, null);
      log(`YARG: ${song.artist} - ${song.name}: no lyrics (${e.message})`);
    }
    readScores(false);
    broadcast({ type: 'yarg', yarg: info() });
    setDetected();
  }

  // ---------- menu music (macOS/Linux) ----------
  // Which song: the song file YARG has open (lsof). When it started: YARG logs "Loaded N stems" right before
  // its menu player starts a song, from the top at normal speed. The music library's previews log the same line
  // but start mid-song, so the start is only trusted (synced) when the song:
  //   - started as the previous menu song ended (the menu player plays songs back to back; previews don't end), or
  //   - is the first song after YARG launched (the main menu), or
  //   - was confirmed on a device ("it's the menu player": confirmMenu()).
  // YARG doesn't say when the menu music is paused or skipped back, so this is approximate.
  let menuPlay = null;      // { file, start (wall s) | null, length, synced }
  let menuLyrics = null;
  let menuLanes = null;
  let lastLoadAt = -1e9;    // wall time of the last "Loaded N stems" seen in the menus
  let launchFresh = false;  // YARG started since we've been watching: its first menu song is the menu player's

  function openSongFiles(cb) {
    if (process.platform === 'win32') return cb([]);
    execFile('pgrep', ['-x', 'YARG'], (err, pids) => {
      const pid = !err && pids.trim().split(/\s+/)[0];
      if (!pid) return cb([]);
      execFile('lsof', ['-Fn', '-p', pid], { maxBuffer: 8 << 20 }, (e2, out) => {
        const files = (out || '').split('\n').filter((l) => l.startsWith('n/')).map((l) => l.slice(1));
        const locs = files.filter((f) => /\.sng$/i.test(f));
        for (const f of files) {
          if (/\.(ogg|opus|mp3|wav|flac)$/i.test(f) && fs.existsSync(path.join(path.dirname(f), 'song.ini'))) locs.push(path.dirname(f));
        }
        cb([...new Set(locs)]);
      });
    });
  }

  function setMenu(file, start, synced) {
    menuPlay = file ? { file, start, length: 0, synced } : null;
    menuSong = null; menuLyrics = null; menuLanes = null;
    if (file) {
      try { menuSong = songInfo(file); menuPlay.length = menuSong.length || 0; } catch { menuSong = { name: path.basename(file).replace(/\.sng$/i, ''), artist: '' }; }
      let chartData = null;
      try { chartData = loadLyrics(file); menuLyrics = { parts: chartData.parts, sections: chartData.sections, beats: chartData.beats }; menuLanes = chartData.lanes || null; } catch (e) { menuLyrics = { error: e.message }; }
      tabs?.setSong({ name: menuSong.name, artist: menuSong.artist }, chartData);
      menuSong = { ...menuSong, synced, start: start ? Date.now() - (wall() - start) * 1000 : null };
      log(`YARG menu: ${menuSong.artist} - ${menuSong.name}${synced ? ' (synced)' : start ? ' (start not confirmed)' : ''}`);
    }
    if (!file && !song) tabs?.setSong(null);
    menuClock();
    broadcast({ type: 'yarg', yarg: info() });
  }
  // the clock follows the menu song while it's synced (the data stream only covers gameplay)
  function menuClock() {
    if (menuPlay?.synced && menuPlay.start && !song) { clock.menu = true; clock.rate = 1; setClock('run', wall() - menuPlay.start); }
    else if (clock.menu) { clock.menu = false; setClock('off', 0); }
  }

  function onAudioLoaded() {
    const w = wall();
    if (song || (stream.live && stream.scene === 'gameplay')) return; // a real song loading
    const prev = menuPlay;
    const chained = !!(prev?.start && prev.length && Math.abs(w - prev.start - prev.length) < 6);
    const first = launchFresh;
    launchFresh = false;
    lastLoadAt = w;
    // the new song's file: the one that isn't the previous song (both can be open for a moment)
    setTimeout(() => openSongFiles((locs) => {
      if (song) return;
      const file = locs.find((f) => f !== prev?.file) || locs[0];
      if (!file) return;
      setMenu(file, w, chained || first);
    }), 300);
  }

  // Also look every few seconds: catches songs we didn't see start (no log line, bridge started late) and silence.
  function pollMenuSong() {
    if (process.platform === 'win32' || song || !running) {
      if (menuPlay && (song || !running)) setMenu(null);
      return;
    }
    openSongFiles((locs) => {
      if (song || wall() - lastLoadAt < 2) return; // a log-driven update is on its way
      if (!locs.length) { if (menuPlay) setMenu(null); return; }
      if (menuPlay && locs.includes(menuPlay.file)) return;
      setMenu(locs[0], null, false); // playing, but we don't know since when
    });
  }
  const menuTimer = setInterval(pollMenuSong, 4000);

  // tail YARG's log (logs/<date>[_n].log; a new file each launch/day)
  let logFile = null, logPos = 0, logWatcher = null;
  function attachLog() {
    const dir = path.join(path.dirname(watchedFile || ''), 'logs');
    let newest = null;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.log')) continue;
        const st = fs.statSync(path.join(dir, f));
        if (!newest || st.mtimeMs > newest.m) newest = { f: path.join(dir, f), m: st.mtimeMs, size: st.size };
      }
    } catch {}
    if (!newest || newest.f === logFile) return;
    logWatcher?.close();
    const fresh = logFile !== null; // a new log while we were watching = YARG (re)started: read it from the top
    logFile = newest.f; logPos = fresh ? 0 : newest.size;
    try { logWatcher = fs.watch(logFile, readLog); } catch { logWatcher = null; }
    if (fresh) readLog();
  }
  function readLog() {
    let fd;
    try {
      fd = fs.openSync(logFile, 'r');
      const size = fs.fstatSync(fd).size;
      if (size < logPos) logPos = 0;
      if (size === logPos) return;
      const buf = Buffer.alloc(Math.min(size - logPos, 4 << 20));
      fs.readSync(fd, buf, 0, buf.length, logPos);
      const text = buf.toString('utf8');
      const end = text.lastIndexOf('\n');
      if (end < 0) return;
      logPos += Buffer.byteLength(text.slice(0, end + 1));
      for (const line of text.slice(0, end).split('\n')) if (/CreateAudioMixer:\d+\] Loaded \d+ stems/.test(line)) onAudioLoaded();
    } catch {} finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  const logTimer = setInterval(attachLog, 3000);

  // ---------- scores (YARG's scores/scores.db, written when a song ends) ----------
  let sqlite = null, scoresFile = null;
  import('node:sqlite').then((m) => { sqlite = m; readScores(true); }).catch(() => log('YARG scores: needs Node 22.13+ (node:sqlite); skipped'));
  function readScores(announce) {
    if (!sqlite || !watchedFile) return;
    const f = path.join(path.dirname(watchedFile), 'scores', 'scores.db');
    if (f !== scoresFile) { if (scoresFile) fs.unwatchFile(scoresFile); scoresFile = f; fs.watchFile(f, { interval: 1500 }, () => readScores(true)); }
    if (!fs.existsSync(f)) return;
    let db;
    try {
      db = new sqlite.DatabaseSync(f, { readOnly: true });
      const rec = db.prepare(`SELECT ${REC_COLS} FROM GameRecords ORDER BY Id DESC LIMIT 1`).get();
      const last = rec && recordWithPlayers(db, rec);
      let best = null;
      if (song) {
        const b = db.prepare(`SELECT ${REC_COLS} FROM GameRecords WHERE SongName = ? AND SongArtist = ? ORDER BY BandScore DESC LIMIT 1`).get(song.name, song.artist);
        const n = db.prepare('SELECT COUNT(*) AS n FROM GameRecords WHERE SongName = ? AND SongArtist = ?').get(song.name, song.artist).n;
        if (b) best = { ...recordWithPlayers(db, b), plays: n };
      }
      const changed = JSON.stringify({ last, best }) !== JSON.stringify(results);
      results = { last, best };
      if (changed && announce) broadcast({ type: 'yarg', yarg: info() });
    } catch (e) {
      log('YARG scores:', e.message);
    } finally { try { db?.close(); } catch {} }
  }

  function watch() {
    if (watchedFile) fs.unwatchFile(watchedFile);
    watchedFile = currentSongFile();
    lastRaw = null;
    fs.watchFile(watchedFile, { interval: 300 }, readSong);
    readSong();
  }
  watch();
  attachLog();
  // YARG may be installed/started after the bridge, or switch between release and nightly
  const rescan = setInterval(() => { if (currentSongFile() !== watchedFile) watch(); }, 10000);

  function info() { return { detected, song, lyrics: song ? lyrics : menuLyrics, menuSong, results, tabs: tabs?.info() ?? null, clock: clockMsg(), file: watchedFile }; }
  return {
    snapshot: info,
    // the Lanes view's notes for the song shown (the one being played, else the menu music): { song: {name, artist}, lanes }
    lanes() {
      const s = song || menuSong;
      return { song: s ? { name: s.name, artist: s.artist } : null, lanes: (song ? songLanes : menuLanes) || {} };
    },
    setDir() { watch(); readScores(true); broadcast({ type: 'yarg', yarg: info() }); },
    // A device asks to do something once per play:
    // the first to ask gets true, the rest false.
    claim(key) {
      if (typeof key !== 'string' || !key.startsWith(`${play}:`) || claims.has(key)) return false;
      claims.add(key);
      return true;
    },
    // A device says the menu song is (or isn't) the menu player's, i.e. it started from the top when it loaded.
    confirmMenu(on) {
      if (!menuPlay?.start || song) return false;
      menuPlay.synced = !!on;
      menuSong = { ...menuSong, synced: !!on };
      menuClock();
      broadcast({ type: 'yarg', yarg: info() });
      return true;
    },
    close() {
      clearInterval(liveTimer); clearInterval(rescan); clearInterval(procTimer); clearInterval(menuTimer); clearInterval(logTimer); logWatcher?.close();
      if (watchedFile) fs.unwatchFile(watchedFile);
      if (scoresFile) fs.unwatchFile(scoresFile);
      sock.close();
    },
  };
}
