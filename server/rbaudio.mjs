// Practice audio for Rock Band songs. A mogg is one Ogg Vorbis with 10–14 channels, which browsers won't play (Chromium
// stops at 8), so it's decoded here and mixed into one stereo WAV per instrument (song.wav for the backing track,
// guitar.wav, drums.wav, …): the same kind of stems a Clone Hero song has, for the practice player to mute and slow down.
//
// Kept in <data>/practice/<song id>/ for the last few songs played, so a song is only decoded once.
//
// Exports createRbAudio({ dataDir, log }) -> { prepare(id, { read(start, end), size, tracks, channels, pans, vols }) -> dir,
//   dirOf(id) -> dir | null when not prepared }
import fs from 'node:fs';
import path from 'node:path';
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis';

const KEEP = 4; // songs kept
const STEM = { drum: 'drums', drums: 'drums', bass: 'bass', guitar: 'guitar', keys: 'keys', vocals: 'vocals' };

function wavHeader(rate, frames) {
  const h = Buffer.alloc(44);
  const data = frames * 4;
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + data, 4); h.write('WAVE', 8, 'latin1');
  h.write('fmt ', 12, 'latin1'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'latin1'); h.writeUInt32LE(data, 40);
  return h;
}

// Which channels make which stem: the instruments' tracks, and what's left (minus the crowd) is the backing track
function groupsOf({ tracks, channels }) {
  const groups = [];
  const used = new Set(tracks.crowd || []);
  for (const [k, ch] of Object.entries(tracks)) {
    if (!STEM[k] || !ch.length) continue;
    const g = groups.find((x) => x.name === STEM[k]);
    if (g) g.channels.push(...ch); else groups.push({ name: STEM[k], channels: [...ch] });
    for (const c of ch) used.add(c);
  }
  const rest = [...Array(channels).keys()].filter((c) => !used.has(c));
  if (rest.length) groups.unshift({ name: 'song', channels: rest });
  return groups;
}

export function createRbAudio({ dataDir, log }) {
  const root = path.join(dataDir, 'practice');
  const busy = new Map(); // id -> Promise

  const dirOf = (id) => {
    const d = path.join(root, id);
    return fs.existsSync(path.join(d, 'done')) ? d : null;
  };

  // keep the KEEP most recently used songs
  function prune(keepId) {
    let list = [];
    try { list = fs.readdirSync(root).map((n) => ({ n, t: fs.statSync(path.join(root, n)).mtimeMs })); } catch { return; }
    list.sort((a, b) => b.t - a.t);
    for (const { n } of list.slice(KEEP)) if (n !== keepId && !busy.has(n)) fs.rmSync(path.join(root, n), { recursive: true, force: true });
  }

  async function build(id, src) {
    const t0 = Date.now();
    const dir = path.join(root, id);
    const tmp = `${dir}.part`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const groups = groupsOf(src);
    // per channel: [left, right] gain (equal-power pan, -1 = left … 1 = right; vols in dB), as YARG mixes a mogg
    const gain = [...Array(src.channels).keys()].map((c) => {
      const th = ((Number(src.pans[c]) || 0) + 1) * (Math.PI / 4), v = 10 ** ((Number(src.vols[c]) || 0) / 20);
      return [v * Math.cos(th), v * Math.sin(th)];
    });
    const outs = groups.map((g) => ({ ...g, fd: fs.openSync(path.join(tmp, `${g.name}.wav`), 'w'), peak: 0 }));
    for (const o of outs) fs.writeSync(o.fd, wavHeader(44100, 0));
    const dec = new OggVorbisDecoder();
    await dec.ready;
    let frames = 0, rate = 44100;
    const write = ({ channelData, samplesDecoded, sampleRate }) => {
      if (!samplesDecoded) return;
      rate = sampleRate || rate;
      for (const o of outs) {
        const buf = Buffer.alloc(samplesDecoded * 4);
        for (let i = 0; i < samplesDecoded; i++) {
          let l = 0, r = 0;
          for (const c of o.channels) { const x = channelData[c]?.[i] || 0; l += x * gain[c][0]; r += x * gain[c][1]; }
          buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l * 32767))), i * 4);
          buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r * 32767))), i * 4 + 2);
          const p = Math.max(Math.abs(l), Math.abs(r));
          if (p > o.peak) o.peak = p;
        }
        fs.writeSync(o.fd, buf);
      }
      frames += samplesDecoded;
    };
    try {
      const CHUNK = 1 << 20;
      for (let at = 0; at < src.size; at += CHUNK) {
        write(await dec.decode(await src.read(at, Math.min(src.size, at + CHUNK) - 1)));
        await new Promise((r) => setImmediate(r)); // stay responsive
      }
      write(await dec.flush());
      for (const o of outs) fs.writeSync(o.fd, wavHeader(rate, frames), 0, 44, 0);
    } finally {
      dec.free();
      for (const o of outs) fs.closeSync(o.fd);
    }
    // a stem that's silent (an instrument with no audio of its own) isn't worth a mute button
    for (const o of outs) if (o.peak < 1e-4 && o.name !== 'song') fs.rmSync(path.join(tmp, `${o.name}.wav`));
    fs.writeFileSync(path.join(tmp, 'done'), '');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
    log(`Practice: prepared ${groups.map((g) => g.name).join(', ')} (${src.channels} channels, ${Math.round(frames / rate)} s) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return dir;
  }

  async function prepare(id, src) {
    const have = dirOf(id);
    if (have) { const now = new Date(); try { fs.utimesSync(have, now, now); } catch {} return have; }
    if (!busy.has(id)) {
      busy.set(id, build(id, src)
        .catch((e) => { fs.rmSync(path.join(root, `${id}.part`), { recursive: true, force: true }); throw e; })
        .finally(() => { busy.delete(id); prune(id); }));
    }
    return busy.get(id);
  }

  return { prepare, dirOf };
}
