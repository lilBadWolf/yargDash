#!/usr/bin/env node
// yargDash server: follows the YARG game running on this computer and serves the dashboard to any browser on the
// network (the page itself and its live data, one port). No dependencies except alphaTab, for Guitar Pro files.
//
//   node server/server.mjs [--port 8900] [--data <dir>] [--log <file>]
//
//   --port  HTTP port (default 8900, or the one saved in <data>/config.json)
//   --data  where settings and Guitar Pro files are kept (default: env YARGDASH_DATA, else ./data)
//   --log   append log output to this file
//
// Endpoints (CORS open, LAN use):
//   GET  /                the dashboard (dist/index.html: `npm run build`)
//   GET  /events          SSE stream: {type:'snapshot'|'yarg'|'yargClock'|'yargBeat'|'yargTabs', ...}
//   GET  /status          JSON status (code fingerprint, pid, LAN addresses)
//   POST /config          {yargDir:'/path/to/YARG data'} ('' = auto: YARG's standard data folder)
//   POST /yarg/menusync   {on:true}                     the menu song started from the top: follow it (approximate)
//   GET  /yarg/lanes                                    the Lanes view's notes: every guitar/bass/drums/keys part of the song shown
//   GET  /yarg/tab/track?id=pro-guitar|gp0…             tablature for one track of the current song (times in song seconds)
//   POST /yarg/tab/upload?name=file.gp5  (raw bytes)    attach a Guitar Pro file to the current YARG song
//   POST /yarg/tab/offset {offset:n|null}               which chart bar the tab starts on (null = automatic)
//   POST /yarg/tab/remove                               detach (delete) the current song's Guitar Pro file
//   POST /yarg/tab/tuning {track, tuning:[midi…]|null}  set a track's tuning for this song (null = as the chart/file says)
//   POST /yarg/tab/find                                 open the Ultimate Guitar search for the song in this computer's browser (this computer only)
//   POST /restart                                       start a fresh copy of the server and exit (this computer only)

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createYarg } from './yarg.mjs';
import { createTabs } from './tabs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PAGE = path.join(ROOT, 'dist', 'index.html');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);

// Started by /restart: wait for the copy that started us to be gone (it holds the port until it exits).
if (args.after) {
  for (let i = 0; i < 50; i++) {
    try { process.kill(Number(args.after), 0); } catch { break; }
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Fingerprint of the server's code, so a restart can be skipped when nothing changed (`npm run restart`).
const CODE = crypto.createHash('sha1');
for (const f of fs.readdirSync(HERE).filter((f) => f.endsWith('.mjs')).sort()) CODE.update(f).update(fs.readFileSync(path.join(HERE, f)));
const CODE_HASH = CODE.digest('hex').slice(0, 12);

const DATA_DIR = path.resolve(args.data || process.env.YARGDASH_DATA || path.join(ROOT, 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
if (args.log) {
  const out = fs.createWriteStream(path.resolve(args.log), { flags: 'a' });
  const write = out.write.bind(out);
  process.stdout.write = write;
  process.stderr.write = write;
}

let config = { httpPort: 8900, yargDir: '' };
try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch {}
if (args.port) config.httpPort = Number(args.port);
const saveConfig = () => fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), () => {});

const log = (...m) => console.log(new Date().toISOString(), ...m);

// This computer's LAN IPv4 addresses (for QR codes that phones can open).
const lanIps = () => Object.entries(os.networkInterfaces())
  .flatMap(([name, list]) => (list || []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ name, ip: a.address })))
  .sort((a, b) => (a.name.startsWith('en') ? 0 : 1) - (b.name.startsWith('en') ? 0 : 1));

// Is this request from this computer (localhost, or one of its own addresses)? Pages open here get the
// Guitar Pro buttons (downloads land in this computer's Downloads folder) and the restart button.
const isLocal = (req) => {
  const a = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || Object.values(os.networkInterfaces()).flat().some((i) => i?.address === a);
};

// ---------- SSE ----------
const clients = new Set();
function broadcast(obj) {
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of clients) res.write(line);
}

function readRaw(req, limit = 16 << 20) {
  return new Promise((resolve, reject) => {
    const parts = []; let n = 0;
    req.on('data', (d) => { n += d.length; if (n > limit) { reject(new Error('file too large')); req.destroy(); } else parts.push(d); });
    req.on('end', () => resolve(Buffer.concat(parts)));
  });
}
function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  const url = new URL(req.url, 'http://x');
  const json = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    fs.readFile(PAGE, (e, buf) => {
      if (e) { res.statusCode = 503; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.end('The dashboard page isn\'t built yet: run `npm run build` in the yargDash folder.'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
    return;
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'snapshot', lan: lanIps(), local: isLocal(req), code: CODE_HASH, yarg: yarg.snapshot() })}\n\n`);
    clients.add(res);
    const ka = setInterval(() => res.write(': ka\n\n'), 15000);
    req.on('close', () => { clients.delete(res); clearInterval(ka); });
    return;
  }
  if (url.pathname === '/status') return json(200, { config, clients: clients.size, lan: lanIps(), code: CODE_HASH, pid: process.pid, data: DATA_DIR });
  if (url.pathname === '/yarg/lanes') return json(200, yarg.lanes());
  if (url.pathname.startsWith('/yarg/tab/')) {
    try {
      if (url.pathname === '/yarg/tab/track') { const t = tabs.track(url.searchParams.get('id')); return t ? json(200, t) : json(404, { error: 'no such track' }); }
      if (req.method !== 'POST') return json(405, { error: 'POST' });
      if (url.pathname === '/yarg/tab/upload') return json(200, { file: await tabs.upload(url.searchParams.get('name') || '', await readRaw(req)) });
      if (url.pathname === '/yarg/tab/offset') { const b = await readBody(req); return json(200, { ok: tabs.setOffset(typeof b.offset === 'number' ? b.offset : null) }); }
      if (url.pathname === '/yarg/tab/remove') return json(200, { ok: tabs.remove() });
      if (url.pathname === '/yarg/tab/find') {
        if (!isLocal(req)) return json(403, { error: 'Only from the YARG computer' });
        const link = tabs.find();
        if (!link) return json(409, { error: 'No YARG song is playing' });
        const [cmd, cargs] = process.platform === 'darwin' ? ['open', [link]] : process.platform === 'win32' ? ['explorer', [link]] : ['xdg-open', [link]];
        execFile(cmd, cargs, (e) => { if (e) log('Tabs: could not open the browser:', e.message); });
        return json(200, { url: link });
      }
      if (url.pathname === '/yarg/tab/tuning') { const b = await readBody(req); return json(200, { ok: tabs.setTuning(b.track, b.tuning ?? null) }); }
    } catch (e) { return json(400, { error: e.message }); }
    return json(404, { error: 'not found' });
  }
  if (req.method === 'POST' && url.pathname === '/yarg/menusync') {
    const body = await readBody(req);
    return res.end(yarg.confirmMenu(body.on !== false) ? 'ok' : 'no');
  }
  if (req.method === 'POST' && url.pathname === '/config') {
    const body = await readBody(req);
    if (typeof body.yargDir === 'string') {
      config.yargDir = body.yargDir.trim();
      saveConfig();
      yarg.setDir();
    }
    return res.end('ok');
  }
  if (req.method === 'POST' && url.pathname === '/restart') {
    if (!isLocal(req)) { res.statusCode = 403; return res.end('only from the YARG computer'); }
    res.end('ok');
    return setTimeout(() => restart('asked to'), 50);
  }
  res.statusCode = 404;
  res.end('not found');
});

// ---------- YARG ----------
const tabs = createTabs({ dataDir: DATA_DIR, log, broadcast });
const yarg = createYarg({ log, broadcast, getDir: () => config.yargDir, tabs });
tabs.watchDownloads(path.join(os.homedir(), 'Downloads'));

// Restart: start a copy of ourselves (same arguments) and exit; it waits for us to be gone (--after).
// Pages reconnect to the new copy by themselves.
function restart(reason) {
  log(`restarting (${reason})`);
  const argv = process.argv.slice(1);
  const i = argv.indexOf('--after');
  if (i >= 0) argv.splice(i, 2);
  spawn(process.execPath, [...argv, '--after', String(process.pid)], { detached: true, stdio: 'ignore', cwd: process.cwd() }).unref();
  server.close();
  for (const c of clients) c.end();
  setTimeout(() => process.exit(0), 100);
}

server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  log(`port ${config.httpPort} is in use: is yargDash already running? (or start it with --port <another>)`);
  process.exit(1);
});
server.listen(config.httpPort, () => {
  log(`yargDash ${CODE_HASH} on :${config.httpPort}, data ${DATA_DIR}`);
  for (const { ip } of lanIps()) log(`  open http://${ip}:${config.httpPort}/ on any phone, tablet or computer on this network`);
});
