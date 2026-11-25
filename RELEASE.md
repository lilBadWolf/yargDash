## 🎸 yargDash 1.2.1

A few things to make building your tab library easier 📚

### 🆕 What's new

- 🔎 **Find tabs from the Library**: in *Needs a tab*, every song has a **Find** button. It opens Ultimate Guitar's search for that song, and a Guitar Pro file you download is added to it by itself. (On the YARG computer.)
- ➕ **Guitar Pro files for songs with Pro charts**: a song whose chart has Pro Guitar, Pro Bass or Pro Keys can get a Guitar Pro file too, and its tracks show next to the chart's. The Tab and Keys views have **Find tab** and **+ Guitar Pro file** for them.
- 📚 *Has tab* and *Needs a tab* are now about Guitar Pro files, so songs with Pro charts show up in *Needs a tab* until they have one. The *Pro Guitar*, *Pro Bass* and *Pro Keys* filters still find the chart tabs.
- 💾 **Tab library in Settings**: see where your tabs are kept and open the folder (or the data folder) with one click. Copy or zip it to back up your tabs; copy it back to restore them.

### ⬇️ Download

| | |
|---|---|
| 🍎 macOS, Apple Silicon | `yargDash-1.2.1-mac-arm64.dmg` |
| 🍏 macOS, Intel | `yargDash-1.2.1-mac-x64.dmg` |
| 🪟 Windows | `yargDash-Setup-1.2.1.exe` |
| 🐧 Linux | `.AppImage` (updates itself) or `.deb` |

Windows and Linux (AppImage) update themselves. On macOS, install the new version over the old one; your tabs and settings stay.

### 🔐 First launch

The app isn't signed by Apple or Microsoft, so the first launch needs one extra step:

- 🍎 **macOS**: open the app; when macOS refuses, go to *System Settings → Privacy & Security* and click **Open Anyway**. If macOS says the app is damaged, run `xattr -cr /Applications/yargDash.app` in Terminal and open it again. Allow incoming connections and local network access when asked 📶.
- 🪟 **Windows**: if SmartScreen warns about an unknown publisher, click *More info → Run anyway*. Allow it through the firewall on private networks.

Rock on 🤘
