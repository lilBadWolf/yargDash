#!/usr/bin/env node
// Start yargDash: build the page if the source changed, then start the server in the background
// (or, if it's already running, restart it when its code changed).
//
//   npm start                 # build if needed, start (or update) the server
//   npm start -- --port 8901  # another port (remembered in data/config.json)
//   npm start -- --foreground # run the server in this terminal instead (Ctrl+C stops it)
//   npm run restart           # restart the running server even if nothing changed
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const fail = (m) => { console.error(`\n  \x1b[31m✗ ${m}\x1b[0m\n`); process.exit(1); };

if (!fs.existsSync(path.join(ROOT, 'node_modules'))) fail('Run `npm install` first.');

// ---------- 1. build the page if any source file is newer than it ----------
const PAGE = path.join(ROOT, 'dist', 'index.html');
const newest = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((m, e) => Math.max(m, e.isDirectory() ? newest(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).mtimeMs), 0);
const srcTime = Math.max(newest(path.join(ROOT, 'src')), ...['index.html', 'vite.config.js', 'package.json'].map((f) => fs.statSync(path.join(ROOT, f)).mtimeMs));
if (!fs.existsSync(PAGE) || fs.statSync(PAGE).mtimeMs < srcTime) {
  try { execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit' }); }
  catch { fail('Building the page failed (see above).'); }
  ok('Built the page');
} else ok('Page is up to date');

// ---------- 2. the server ----------
const DATA = path.resolve(process.env.YARGDASH_DATA || path.join(ROOT, 'data'));
let port = Number(opt('port')) || 8900;
try { if (!opt('port')) port = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')).httpPort || port; } catch {}
const base = `http://127.0.0.1:${port}`;
const serverArgs = [path.join(ROOT, 'server', 'server.mjs'), ...(opt('port') ? ['--port', String(port)] : [])];

if (flag('foreground')) {
  spawn(process.execPath, serverArgs, { stdio: 'inherit', cwd: ROOT }).on('exit', (c) => process.exit(c ?? 0));
} else {
  const code = crypto.createHash('sha1');
  const dir = path.join(ROOT, 'server');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()) code.update(f).update(fs.readFileSync(path.join(dir, f)));
  const want = code.digest('hex').slice(0, 12);
  const status = () => fetch(`${base}/status`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json()).catch(() => null);
  const st = await status();
  const lan = (s) => (s?.lan || []).map((a) => `http://${a.ip}:${port}/`);

  if (st && st.code === want && !flag('restart')) {
    ok(`Server is running and up to date (pid ${st.pid})`);
  } else if (st) {
    const r = await fetch(`${base}/restart`, { method: 'POST', signal: AbortSignal.timeout(2000) }).catch(() => null);
    if (!r?.ok) fail(`Port ${port} is answering but didn't restart (${r ? r.status : 'no answer'}). Is something else using it?`);
    let now = null;
    for (let i = 0; i < 25 && !(now && now.pid !== st.pid); i++) { await new Promise((res) => setTimeout(res, 200)); now = await status(); }
    if (now && now.pid !== st.pid) ok(`Restarted the server${now.code === want ? '' : ' (but its code still differs: check data/yargdash.log)'}`);
    else fail('The server didn\'t come back: check data/yargdash.log');
  } else {
    fs.mkdirSync(DATA, { recursive: true });
    const logFile = path.join(DATA, 'yargdash.log');
    spawn(process.execPath, [...serverArgs, '--log', logFile], { detached: true, stdio: 'ignore', cwd: ROOT }).unref();
    let now = null;
    for (let i = 0; i < 25 && !now; i++) { await new Promise((res) => setTimeout(res, 200)); now = await status(); }
    if (!now) fail(`The server didn't start: see ${logFile}`);
    ok(`Started the server (pid ${now.pid}, log: data/yargdash.log)`);
  }
  const s = await status();
  console.log(`\n  Open  ${lan(s)[0] || `http://localhost:${port}/`}  on any phone, tablet or computer on this network.\n`);
  if (!flag('restart') && process.platform === 'darwin') console.log('  Start YARG with  npm run yarg  so its data stream reaches the dashboard.\n');
}
