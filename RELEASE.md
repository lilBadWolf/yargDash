## 🎉 yargDash is now a desktop app!

Install it, open it, and the dashboard is live on this computer and on every phone on your network 📱✨ You no longer need Node.js or a terminal.

### 🆕 What's new

- 🖥️ **Desktop app** for macOS, Windows and Linux. Closing the window leaves it running in the menu bar or tray, so phones stay connected. That menu shows the address for phones and has *Start YARG* (macOS), *Open at login* and *Restart server*.
- 📚 **Library**: browse and search every song in YARG's song folders, with album art 🖼️. Filter by songs with or without a tab, Pro parts, harmonies and more.
- 🔎 **Song details**: tap a song to see its instruments and difficulty 🎸🥁🎹🎤, vocal parts, sections and your best score 🏆. It also shows its tab and **how well the tab lines up** 🎯. *Find tab*, adding a Guitar Pro file and removing one all work without playing the song.
- ▶️ **Start YARG** (macOS): if your Mac blocks YARG's data stream, yargDash notices and offers to restart YARG with its fix, from *Settings*, the dashboard or the menu bar. Otherwise, just start YARG as usual.
- 🎛️ **Settings** redesigned: a checklist for setting up YARG ✅, the song folders, and a QR code for phones.
- 🎨 New look: the lane icon is the app's logo everywhere.
- 🔄 **Updates**: on Windows and Linux (AppImage) the app updates itself. On macOS it tells you when a new version is out.

### ⬇️ Download

| | |
|---|---|
| 🍎 macOS, Apple Silicon | `yargDash-1.1.0-mac-arm64.dmg` |
| 🍏 macOS, Intel | `yargDash-1.1.0-mac-x64.dmg` |
| 🪟 Windows | `yargDash-Setup-1.1.0.exe` |
| 🐧 Linux | `.AppImage` (updates itself) or `.deb` |

### 🔐 First launch

The app isn't signed by Apple or Microsoft, so the first launch needs one extra step:

- 🍎 **macOS**: open the app; when macOS refuses, go to *System Settings → Privacy & Security* and click **Open Anyway**. If macOS says the app is damaged, run `xattr -cr /Applications/yargDash.app` in Terminal and open it again. Allow incoming connections and local network access when asked 📶: that's how phones reach it and how it hears YARG. If YARG still shows yellow, turn on **yargDash** in *Privacy & Security → Local Network*, or tick *Send YARG's stream to this Mac only* in Settings.
- 🪟 **Windows**: if SmartScreen warns about an unknown publisher, click *More info → Run anyway*. Allow it through the firewall on private networks.

### 📦 Coming from `npm start`?

Your tabs are in its `data/` folder. To use them in the app, copy `data/tabs/` and `data/config.json` into the app's data folder (its menu → *Show data folder*) while the app is closed.

Rock on 🤘
