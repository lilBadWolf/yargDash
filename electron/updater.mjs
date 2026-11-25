// Updates for the desktop app, from the GitHub releases that .github/workflows/release.yml publishes.
//
//  * Windows and Linux (AppImage): electron-updater downloads a new version in the background and installs it when
//    the app quits, or right away from the tray ("Restart to update").
//  * macOS and Linux .deb: the app can't replace itself (macOS only lets apps signed with an Apple Developer ID
//    update in place), so it checks GitHub for a newer release and offers to open its download page.
//
// Checks 10 s after starting, then every 6 hours, and when asked ("Check for updates…").
import { app, dialog, shell, Notification } from 'electron';
import updaterPkg from 'electron-updater';

const REPO = 'lilBadWolf/yargDash';
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const { autoUpdater } = updaterPkg;

// newer("1.10.0", "1.9.2") === true
const newer = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

export function createUpdater({ onChange, log = () => {} }) {
  // idle | checking | available (mac/deb: download page) | downloading | ready (installs on restart) | error
  const state = { status: 'idle', version: '', percent: 0, url: RELEASES };
  const inPlace = process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE);
  let manual = false, notified = '';
  const set = (s) => { Object.assign(state, s); onChange(); };
  const notify = (title, body) => { if (Notification.isSupported()) new Notification({ title, body }).show(); };

  if (inPlace) {
    autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => set({ status: 'checking' }));
    autoUpdater.on('update-available', (i) => set({ status: 'downloading', version: i.version, percent: 0 }));
    autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-not-available', () => { set({ status: 'idle' }); if (manual) dialog.showMessageBox({ message: 'yargDash is up to date', detail: `You have the latest version, ${app.getVersion()}.` }); manual = false; });
    autoUpdater.on('update-downloaded', (i) => {
      set({ status: 'ready', version: i.version });
      if (notified !== i.version) { notified = i.version; notify(`yargDash ${i.version} is ready`, 'It installs when yargDash quits, or choose “Restart to update” in the tray menu.'); }
      manual = false;
    });
    autoUpdater.on('error', (e) => { log(`Update: ${e?.message || e}`); set({ status: 'error' }); if (manual) dialog.showErrorBox('Couldn’t check for updates', String(e?.message || e)); manual = false; });
  }

  async function checkGitHub() {
    set({ status: 'checking' });
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'yargDash' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 404) { set({ status: 'idle' }); return; } // nothing released yet
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const rel = await r.json();
      const v = String(rel.tag_name || '').replace(/^v/, '');
      if (v && newer(v, app.getVersion())) {
        set({ status: 'available', version: v, url: rel.html_url || RELEASES });
        if (notified !== v) { notified = v; notify(`yargDash ${v} is available`, 'Choose “Download yargDash …” in the menu-bar menu.'); }
        if (manual) offerDownload();
      } else {
        set({ status: 'idle' });
        if (manual) dialog.showMessageBox({ message: 'yargDash is up to date', detail: `You have the latest version, ${app.getVersion()}.` });
      }
    } catch (e) {
      log(`Update check: ${e.message}`);
      set({ status: 'error' });
      if (manual) dialog.showErrorBox('Couldn’t check for updates', e.message);
    }
    manual = false;
  }

  async function offerDownload() {
    const r = await dialog.showMessageBox({ message: `yargDash ${state.version} is available`, detail: `You have ${app.getVersion()}. Download the new version from GitHub and replace the app with it (your settings and tabs are kept).`, buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1 });
    if (r.response === 0) shell.openExternal(state.url);
  }

  function check(byHand = false) {
    if (!app.isPackaged) { if (byHand) dialog.showMessageBox({ message: 'Updates are checked in the packaged app only.' }); return; }
    if (state.status === 'checking' || state.status === 'downloading') return;
    manual = byHand;
    if (state.status === 'ready' && byHand) return restart();
    if (inPlace) autoUpdater.checkForUpdates().catch(() => {}); else checkGitHub();
  }

  function restart() { setImmediate(() => autoUpdater.quitAndInstall()); }

  // tray menu items for the current state
  function menuItems() {
    switch (state.status) {
      case 'ready': return [{ label: `Restart to update to ${state.version}`, click: restart }];
      case 'available': return [{ label: `Download yargDash ${state.version}…`, click: offerDownload }];
      case 'downloading': return [{ label: `Downloading ${state.version}… ${state.percent}%`, enabled: false }];
      case 'checking': return [{ label: 'Checking for updates…', enabled: false }];
      default: return [{ label: 'Check for updates…', click: () => check(true) }];
    }
  }

  setTimeout(() => check(), 10e3);
  setInterval(() => check(), 6 * 3600e3);
  return { check, menuItems, state };
}
