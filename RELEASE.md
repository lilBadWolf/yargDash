## 🎸 yargDash 1.4.1

Phones find yargDash on Windows 🪟📱

### 🛠️ Fixed

- 🪟 **Windows: phones and tablets can reach yargDash.** The installer now lets yargDash through Windows Firewall on private networks (Windows asks for permission once; updates don't ask again, and uninstalling removes the rule). It also clears a "Block" left behind if Windows' own "allow access?" prompt was dismissed. Still can't connect? Make sure Windows has your network set to *Private*, not *Public* (*Settings → Network & internet → your network*).

### 🎹 New in 1.4

MIDI keyboards with key lights (The ONE keyboards and others), Keys effects, Rock Band (CON) songs in the Library and in practice, every view keeping your place, and Settings in tabs. See the [1.4.0 release](https://github.com/lilBadWolf/yargDash/releases/tag/v1.4.0).

### ⬇️ Download

| | |
|---|---|
| 🍎 macOS, Apple Silicon | `yargDash-1.4.1-mac-arm64.dmg` |
| 🍏 macOS, Intel | `yargDash-1.4.1-mac-x64.dmg` |
| 🪟 Windows | `yargDash-Setup-1.4.1.exe` |
| 🐧 Linux | `.AppImage` (updates itself) or `.deb` |

Windows and Linux (AppImage) update themselves. On macOS, install the new version over the old one; your tabs and settings stay.

### 🔐 First launch

The app isn't signed by Apple or Microsoft, so the first launch needs one extra step:

- 🍎 **macOS**: open the app; when macOS refuses, go to *System Settings → Privacy & Security* and click **Open Anyway**. If macOS says the app is damaged, run `xattr -cr /Applications/yargDash.app` in Terminal and open it again. Allow incoming connections and local network access when asked 📶.
- 🪟 **Windows**: if SmartScreen warns about an unknown publisher, click *More info → Run anyway*. Allow it through the firewall on private networks.

Rock on 🤘
