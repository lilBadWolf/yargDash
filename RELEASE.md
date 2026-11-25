## 🎹 yargDash 1.2.0: Keys!

A new view for the keyboard player: the song's keyboard part falls onto piano keys in time with the song, Synthesia-style ✨

### 🆕 What's new

- 🎹 **Keys view**: notes fall onto the keys that play them, and each key lights up while its note sounds (right hand teal, left hand purple). The keyboard spans the part's range, with note names on the notes and keys and the chord name when there is one. 🐢 / 🐇 set the speed, and the QR button opens it on a tablet on the keyboard stand 📱
  - Songs whose chart has **Pro Keys** have it automatically, with Rock Band's 17-key window marked as it moves.
  - **Guitar Pro files**: their piano, organ and synth parts show here, lined up with the song like the tabs. One file can give you several (Rosanna: piano, two organs, synths 🎶).
- 🎸 **Tabs**: keyboard parts no longer show up as nonsense guitar tab. Anything tabbed on 4 or 5 strings is a bass tab, even a synth bass (it shows in Keys too).
- 📚 **Library filters**: *Pro Guitar*, *Pro Bass* and *Pro Keys* (in the chart) replace *Pro parts*, and *Keys* finds songs whose Guitar Pro file has a keyboard part. Those songs get a **KEYS** badge.
- 📏 **Tidier controls**: when the view and track buttons don't fit on one line (phones, songs with lots of tracks), they turn into dropdowns.

### 🛠️ Fixes

- 💥 A Guitar Pro file whose repeats confuse the file reader could freeze yargDash and crash it over and over. Now that file just plays without its repeats.
- 🤘 Songs whose names have special characters (like YARG's `AC／DC` folders) weren't recognised in the menu on macOS, so their tabs weren't picked up.
- 🔎 A downloaded tab is matched more often: "Runnin'" and "Running" count as the same title, and when the title inside the file has a typo, the file name is used.

### ⬇️ Download

| | |
|---|---|
| 🍎 macOS, Apple Silicon | `yargDash-1.2.0-mac-arm64.dmg` |
| 🍏 macOS, Intel | `yargDash-1.2.0-mac-x64.dmg` |
| 🪟 Windows | `yargDash-Setup-1.2.0.exe` |
| 🐧 Linux | `.AppImage` (updates itself) or `.deb` |

Windows and Linux (AppImage) update themselves. On macOS, install the new version over the old one; your tabs and settings stay.

### 🔐 First launch

The app isn't signed by Apple or Microsoft, so the first launch needs one extra step:

- 🍎 **macOS**: open the app; when macOS refuses, go to *System Settings → Privacy & Security* and click **Open Anyway**. If macOS says the app is damaged, run `xattr -cr /Applications/yargDash.app` in Terminal and open it again. Allow incoming connections and local network access when asked 📶.
- 🪟 **Windows**: if SmartScreen warns about an unknown publisher, click *More info → Run anyway*. Allow it through the firewall on private networks.

Rock on 🤘
