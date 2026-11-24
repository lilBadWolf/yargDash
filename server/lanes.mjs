// Note lanes for the YARG tab's Lanes view (an audience/preview screen): every five-fret and drum part the chart
// has, at Expert, whether or not anyone is playing it in YARG.
//
// Five-fret parts (guitar, rhythm, bass, keys): lanes 0-4 = green, red, yellow, blue, orange; 5 = open note.
//   HOPOs: a single note within a third of a beat of the previous one, on a different fret (natural), or forced
//   (MIDI 101 / 102 = force HOPO / strum, .chart N 5 = flip the natural one). Taps: MIDI 104 or N 6. Keys have none.
//   Sustains shorter than a third of a beat are dropped, like the games do.
// Drums: lane 0 = kick, 1-4 = red, yellow, blue, green (5 pads on 5-lane charts: red, yellow, blue, orange, green).
//   Pro drums: yellow/blue/green are cymbals unless a tom marker covers them (MIDI 110-112); .chart marks
//   cymbals instead (N 66-68). Charts with neither are plain pads.
// Star power (MIDI 116, .chart S 2) and solos (MIDI 103, .chart E solo/soloend) come as [start, end] spans.
//
// Output per part: { name, kind: 'five'|'drums', pads (drums), notes: [[t, dur, lane, flags]], star: [[s, e]], solo: [[s, e]] }
export const LANE = { HOPO: 1, TAP: 2, CYMBAL: 4, KICK2: 8, STAR: 16 };

const r3 = (x) => Math.round(x * 1000) / 1000;
const PARTS = [
  // key, label, MIDI track, .chart section, kind
  ['guitar', 'Guitar', 'PART GUITAR', 'ExpertSingle', 'five'],
  ['rhythm', 'Rhythm', 'PART RHYTHM', 'ExpertDoubleRhythm', 'five'],
  ['bass', 'Bass', 'PART BASS', 'ExpertDoubleBass', 'five'],
  ['drums', 'Drums', 'PART DRUMS', 'ExpertDrums', 'drums'],
  ['keys', 'Keys', 'PART KEYS', 'ExpertKeyboard', 'five'],
];

// on/off pairs → [startTick, endTick] spans
function spansOf(events, note) {
  const out = []; let st = null;
  for (const e of events) {
    if (e.note !== note) continue;
    if (e.on && st === null) st = e.tick;
    else if (!e.on && st !== null) { out.push([st, e.tick]); st = null; }
  }
  return out;
}
const inSpans = (spans, t) => spans.some(([a, b]) => t >= a && t < b);

// Natural HOPOs for five-fret notes [{tick, len, lane, force: 'hopo'|'strum'|'flip'|null, tap}], grouped by tick.
function markHopos(notes, threshold) {
  const groups = [];
  for (const n of notes) { const g = groups[groups.length - 1]; if (g && g.tick === n.tick) g.notes.push(n); else groups.push({ tick: n.tick, notes: [n] }); }
  let prev = null;
  for (const g of groups) {
    const lanes = g.notes.map((n) => n.lane);
    let hopo = !!prev && g.notes.length === 1 && g.tick - prev.tick <= threshold && !prev.lanes.includes(lanes[0]);
    const force = g.notes.find((n) => n.force)?.force;
    if (force === 'hopo') hopo = true;
    else if (force === 'strum') hopo = false;
    else if (force === 'flip') hopo = !hopo;
    const tap = g.notes.some((n) => n.tap);
    for (const n of g.notes) n.flags |= tap ? LANE.TAP : hopo ? LANE.HOPO : 0;
    prev = { tick: g.tick, lanes };
  }
}

function finish(name, kind, notes, star, solo, sec, sustainMin, extra = {}) {
  notes.sort((a, b) => a.tick - b.tick || a.lane - b.lane);
  return {
    name, kind, ...extra,
    notes: notes.map((n) => {
      const t = sec(n.tick);
      const dur = kind === 'five' && n.len >= sustainMin ? r3(sec(n.tick + n.len) - t) : 0;
      return [r3(t), dur, n.lane, n.flags | (inSpans(star, n.tick) ? LANE.STAR : 0)];
    }),
    star: star.map(([a, b]) => [r3(sec(a)), r3(sec(b))]),
    solo: solo.map(([a, b]) => [r3(sec(a)), r3(sec(b))]),
  };
}

// ---------- MIDI (notes.mid) ----------
// Phase Shift sysex: 'P' 'S' 0 0 difficulty(3 = expert, 0xFF = all) type(1 = open, 4 = tap) on/off
function psSpans(tr, type) {
  const out = []; let st = null;
  for (const x of tr.sysex || []) {
    const d = x.data;
    if (d.length < 7 || d[0] !== 0x50 || d[1] !== 0x53 || d[5] !== type || (d[4] !== 3 && d[4] !== 0xff)) continue;
    if (d[6] && st === null) st = x.tick;
    else if (!d[6] && st !== null) { out.push([st, x.tick]); st = null; }
  }
  return out;
}

export function midiLanes(tracks, res, sec, decodeText) {
  const out = {};
  for (const [key, label, trackName, , kind] of PARTS) {
    const tr = tracks.find((t) => t.name === trackName);
    if (!tr) continue;
    const ev = tr.events.filter((e) => e.note !== undefined);
    const star = spansOf(ev, 116), solo = spansOf(ev, 103);
    const notes = [];
    const pairs = (lo, hi, fn) => {
      const open = {};
      for (const e of ev) {
        if (e.note < lo || e.note > hi) continue;
        if (e.on) open[e.note] = e;
        else if (open[e.note]) { fn(open[e.note], e.tick - open[e.note].tick); delete open[e.note]; }
      }
    };
    if (kind === 'five') {
      const texts = tr.events.filter((e) => e.meta === 0x01).map((e) => decodeText(e.data).trim());
      const enhancedOpens = texts.some((x) => /^\[?ENHANCED_OPENS\]?$/.test(x));
      const hopoOn = spansOf(ev, 101), strumOn = spansOf(ev, 102), tapOn = [...spansOf(ev, 104), ...psSpans(tr, 4)], openOn = psSpans(tr, 1);
      pairs(enhancedOpens ? 95 : 96, 100, (on, len) => {
        let lane = on.note === 95 ? 5 : on.note - 96;
        if (lane === 0 && inSpans(openOn, on.tick)) lane = 5; // sysex open: the green note becomes an open note
        const force = key === 'keys' ? null : inSpans(hopoOn, on.tick) ? 'hopo' : inSpans(strumOn, on.tick) ? 'strum' : null;
        notes.push({ tick: on.tick, len, lane, force, tap: key !== 'keys' && inSpans(tapOn, on.tick), flags: 0 });
      });
      if (!notes.length) continue;
      if (key !== 'keys') markHopos(notes.sort((a, b) => a.tick - b.tick || a.lane - b.lane), Math.round((res * 170) / 480));
      out[key] = finish(label, kind, notes, star, solo, sec, res / 3);
    } else {
      const five = ev.some((e) => e.on && e.note === 101);
      const toms = { 98: spansOf(ev, 110), 99: spansOf(ev, 111), 100: spansOf(ev, 112) };
      const pro = !five && (toms[98].length || toms[99].length || toms[100].length);
      pairs(95, five ? 101 : 100, (on) => {
        if (on.note <= 96) { notes.push({ tick: on.tick, lane: 0, flags: on.note === 95 ? LANE.KICK2 : 0 }); return; }
        const lane = on.note - 96; // 1 red, 2 yellow, 3 blue, 4 green (5-lane: 4 orange, 5 green)
        const cym = pro && on.note >= 98 && !inSpans(toms[on.note], on.tick);
        notes.push({ tick: on.tick, lane, flags: cym ? LANE.CYMBAL : 0 });
      });
      if (!notes.length) continue;
      out[key] = finish(label, kind, notes, star, solo, sec, Infinity, { pads: five ? 5 : 4 });
    }
  }
  return out;
}

// ---------- .chart ----------
export function chartLanes(sections, res, sec) {
  const out = {};
  for (const [key, label, , section, kind] of PARTS) {
    const lines = sections[section];
    if (!lines?.length) continue;
    const ns = [], star = [], solo = [];
    let soloStart = null;
    for (const l of lines) {
      const m = l.match(/^(\d+)\s*=\s*([NSE])\s+(\S+)(?:\s+(\d+))?/);
      if (!m) continue;
      const tick = +m[1];
      if (m[2] === 'N') ns.push({ tick, v: +m[3], len: +(m[4] || 0) });
      else if (m[2] === 'S' && m[3] === '2') star.push([tick, tick + +(m[4] || 0)]);
      else if (m[2] === 'E' && m[3] === 'solo') soloStart = tick;
      else if (m[2] === 'E' && m[3] === 'soloend' && soloStart !== null) { solo.push([soloStart, tick]); soloStart = null; }
    }
    const byTick = new Map();
    for (const n of ns) { if (!byTick.has(n.tick)) byTick.set(n.tick, []); byTick.get(n.tick).push(n); }
    const notes = [];
    if (kind === 'five') {
      for (const [tick, list] of byTick) {
        const flip = list.some((n) => n.v === 5), tap = key !== 'keys' && list.some((n) => n.v === 6);
        for (const n of list) {
          if (n.v <= 4 || n.v === 7) notes.push({ tick, len: n.len, lane: n.v === 7 ? 5 : n.v, force: flip && key !== 'keys' ? 'flip' : null, tap, flags: 0 });
        }
      }
      if (!notes.length) continue;
      if (key !== 'keys') markHopos(notes.sort((a, b) => a.tick - b.tick || a.lane - b.lane), Math.round((res * 65) / 192));
      out[key] = finish(label, kind, notes, star, solo, sec, res / 3);
    } else {
      const five = ns.some((n) => n.v === 5);
      const pro = !five && ns.some((n) => n.v >= 66 && n.v <= 68);
      for (const [tick, list] of byTick) {
        const has = (v) => list.some((n) => n.v === v);
        for (const n of list) {
          if (n.v === 0) notes.push({ tick, lane: 0, flags: 0 });
          else if (n.v === 32) notes.push({ tick, lane: 0, flags: LANE.KICK2 });
          else if (n.v >= 1 && n.v <= (five ? 5 : 4)) notes.push({ tick, lane: n.v, flags: pro && n.v >= 2 && has(64 + n.v) ? LANE.CYMBAL : 0 });
        }
      }
      if (!notes.length) continue;
      out[key] = finish(label, kind, notes, star, solo, sec, Infinity, { pads: five ? 5 : 4 });
    }
  }
  return out;
}
