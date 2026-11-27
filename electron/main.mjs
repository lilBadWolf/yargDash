// yargDash desktop app: runs the yargDash server (server/server.mjs, unchanged) in a background process, shows the
// dashboard in a window, and keeps a menu-bar / tray icon. Closing the window leaves the server running, so phones
// stay connected; Quit (tray, or Cmd+Q) stops it.
//
//   npm run app     # build the page and run the app from this folder (data: ./data, as with npm start)
//   npm run dist    # package it (release/)
import { app, BrowserWindow, Tray, Menu, nativeImage, shell, utilityProcess, dialog, clipboard, Notification } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUpdater } from './updater.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_MAC = process.platform === 'darwin';
// Packaged: settings and Guitar Pro files in the app's data folder. From a checkout: ./data, shared with `npm start`.
// YARGDASH_DATA overrides both, as it does for the server.
const DATA = path.resolve(process.env.YARGDASH_DATA || (app.isPackaged ? app.getPath('userData') : path.join(ROOT, 'data')));
const LOG = path.join(DATA, 'yargdash.log');
const YARG_DIR = app.isPackaged ? path.join(process.resourcesPath, 'yarg') : path.join(ROOT, 'yarg');
const icon = (f) => path.join(ROOT, 'electron', 'assets', f);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null, tray = null, server = null, quitting = false, external = false, lan = [], updater = null;

const port = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')).httpPort || 8900; } catch { return 8900; } };
const base = () => `http://127.0.0.1:${port()}`;
const status = () => fetch(`${base()}/status`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json()).catch(() => null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logTail = () => { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(-6).join('\n'); } catch { return ''; } };

// ---------- the server ----------
let crashes = 0;
function startServer() {
  fs.mkdirSync(DATA, { recursive: true });
  const started = Date.now();
  server = utilityProcess.fork(path.join(ROOT, 'server', 'server.mjs'), ['--data', DATA, '--log', LOG], {
    serviceName: 'yargDash server',
    // the YARG launcher (Start YARG): the script, its prebuilt library when packaged, and somewhere writable for its state
    env: { ...process.env, YARGDASH_APP: '1', YARGDASH_YARG_DIR: YARG_DIR, YARGDASH_STATE: path.join(DATA, 'yarg'),
      ...(app.isPackaged ? { YARGDASH_LIB: path.join(YARG_DIR, 'yarg-broadcast.dylib') } : {}) },
  });
  server.on('exit', async (code) => {
    server = null;
    if (quitting) return;
    if (code === 75) return startServer(); // the server asked to be restarted (Settings → Restart server)
    if (Date.now() - started < 4000) {
      // Didn't get going: most likely the port is taken, perhaps by a yargDash started with `npm start`.
      const st = await status();
      if (st?.code) { external = true; updateTray(); return; }
      dialog.showErrorBox('yargDash server didn\'t start', `${logTail() || `Exit code ${code}`}\n\nThe log is ${LOG}`);
      return;
    }
    if (++crashes <= 3) { await sleep(1000); startServer(); }
  });
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) { const st = await status(); if (st) return st; await sleep(200); }
  return null;
}

async function restartServer() {
  await fetch(`${base()}/restart`, { method: 'POST', signal: AbortSignal.timeout(2000) }).catch(() => null);
}

// ---------- the window ----------
async function showWindow() {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 420, minHeight: 360,
    title: 'yargDash', backgroundColor: '#0b0d10', autoHideMenuBar: true, show: false,
    icon: IS_MAC ? undefined : icon('icon.png'),
    // not throttled behind other windows: practice audio and a MIDI keyboard's key lights keep time
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  const own = (url) => url.startsWith(base());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!own(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.on('did-fail-load', async (_e, _code, _desc, url, isMain) => { if (isMain && win) { await sleep(1000); win?.loadURL(`${base()}/`); } });

  await waitForServer();
  win?.loadURL(`${base()}/`);
}

// ---------- Start YARG (macOS: with the data-stream fix; the server runs yarg/start-yarg.sh, POST /yarg/start) ----------
async function startYarg(opts = {}) {
  const r = await fetch(`${base()}/yarg/start`, { method: 'POST', body: JSON.stringify(opts), signal: AbortSignal.timeout(70000) })
    .then((x) => x.json()).catch((e) => ({ ok: false, code: -1, message: e.message }));
  if (r.ok) return notify('Starting YARG', 'Make sure Settings → All Settings → Experimental → Enable UDP Data Stream is on.');
  if (r.code === 3) {
    const a = await dialog.showMessageBox({ type: 'question', message: 'YARG is already running', detail: 'Restart it with yargDash\'s fix? Only needed if your Mac blocks YARG\'s data stream (Settings in yargDash says so). Leave the song you\'re in first.', buttons: ['Restart YARG', 'Cancel'], defaultId: 0, cancelId: 1 });
    if (a.response === 0) startYarg({ ...opts, restart: true });
    return;
  }
  if (r.code === 2) {
    const p = await dialog.showOpenDialog({ title: 'Where is YARG?', message: 'Choose YARG.app (in YARC Launcher\'s "YARG Installs" folder, …/installation/YARG.app)', properties: ['openFile', 'treatPackageAsDirectory'], filters: [{ name: 'YARG', extensions: ['app'] }] });
    if (!p.canceled && p.filePaths[0]) startYarg({ ...opts, app: p.filePaths[0].replace(/(\.app)\/.*$/, '$1') });
    return;
  }
  dialog.showErrorBox('Couldn\'t start YARG', r.message || 'Unknown error');
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

// ---------- tray ----------
function phoneUrl() { return lan[0] ? `http://${lan[0].ip}:${port()}/` : null; }

function updateTray() {
  if (!tray) return;
  const url = phoneUrl();
  const login = app.getLoginItemSettings();
  tray.setToolTip(url ? `yargDash: ${url}` : 'yargDash');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open yargDash', click: showWindow },
    { label: 'Open in browser', click: () => shell.openExternal(`${base()}/`) },
    { type: 'separator' },
    url ? { label: `Phones: ${url}`, toolTip: 'Copy', click: () => clipboard.writeText(url) } : { label: 'Not on a network', enabled: false },
    ...lan.slice(1).map((a) => ({ label: `      ${a.ip} (${a.name})`, click: () => clipboard.writeText(`http://${a.ip}:${port()}/`) })),
    ...(external ? [{ label: 'Using the server started with npm start', enabled: false }] : []),
    { type: 'separator' },
    ...(IS_MAC ? [{ label: 'Start YARG', click: () => startYarg() }, { type: 'separator' }] : []),
    ...(process.platform !== 'linux' && app.isPackaged ? [{ label: 'Open at login', type: 'checkbox', checked: login.openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, openAsHidden: true }) }] : []),
    { label: 'Restart server', click: restartServer },
    { label: 'Show data folder', click: () => shell.openPath(DATA) },
    { label: 'Show log', click: () => shell.showItemInFolder(LOG) },
    { type: 'separator' },
    ...(updater ? updater.menuItems() : []),
    { label: `yargDash ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit yargDash', role: 'quit' },
  ]));
}

function makeTray() {
  const img = nativeImage.createFromPath(icon(IS_MAC ? 'trayTemplate.png' : 'tray.png'));
  if (IS_MAC) img.setTemplateImage(true);
  tray = new Tray(img);
  if (!IS_MAC) tray.on('click', showWindow); // macOS: click opens the menu
  updateTray();
  // Keep the phone address current (Wi-Fi changes, server restarts).
  const refresh = async () => { const st = await status(); if (st) { lan = st.lan || []; updateTray(); } };
  refresh();
  setInterval(refresh, 10000);
}

// ---------- app ----------
app.setName('yargDash');
if (process.platform === 'win32') app.setAppUserModelId('io.github.lilbadwolf.yargdash'); // Windows: needed for notifications
app.on('second-instance', showWindow);
app.on('activate', showWindow); // macOS: Dock icon clicked
app.on('window-all-closed', () => {
  // Keep running in the tray; the first time on Windows/Linux, say so.
  if (!IS_MAC && !fs.existsSync(path.join(DATA, '.tray-hint'))) {
    fs.writeFileSync(path.join(DATA, '.tray-hint'), '');
    notify('yargDash is still running', 'Phones stay connected. Quit from the tray icon.');
  }
});
app.on('before-quit', () => { quitting = true; server?.kill(); });

// Log whether macOS lets the app onto the local network (it needs to be, to hear YARG's broadcast stream)
function probeLocalNetwork() {
  import('node:dgram').then(({ default: dgram }) => {
    const s = dgram.createSocket('udp4');
    s.bind(0, () => {
      s.setBroadcast(true);
      s.send(Buffer.from('yargDash'), 9, '255.255.255.255', (e) => {
        fs.appendFile(LOG, `${new Date().toISOString()} App (main process) local network: ${e ? `refused (${e.code})` : 'allowed'}\n`, () => {});
        s.close();
      });
    });
  });
}

app.whenReady().then(async () => {
  probeLocalNetwork();
  if (IS_MAC && !app.isPackaged) app.dock?.setIcon(icon('icon.png')); // packaged: the app bundle's icon
  // Already running from `npm start` on this port? Use it rather than fight over the port.
  if ((await status())?.code) external = true;
  else startServer();
  updater = createUpdater({ onChange: updateTray, log: (...m) => fs.appendFile(LOG, `${new Date().toISOString()} ${m.join(' ')}\n`, () => {}) });
  makeTray();
  const login = app.getLoginItemSettings();
  if (!(login.wasOpenedAsHidden || process.argv.includes('--hidden'))) showWindow();
});
