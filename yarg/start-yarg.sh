#!/bin/sh
# Start YARG with its UDP Data Stream working on macOS (so yargDash follows the song).
#
#   npm run yarg                    # or double-click "yarg/Start YARG.command"
#   npm run yarg -- "/path/to/YARG.app"   # first time, if YARG isn't found automatically
#
# Loads yarg-broadcast.dylib into YARG (see broadcast-fix.c). YARG itself is not modified.
# Also turn on YARG's Settings > All Settings > Experimental > Enable UDP Data Stream (once).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
LIB="$HERE/build/yarg-broadcast.dylib"
SAVED="$HERE/build/yarg-app-path"
mkdir -p "$HERE/build"

if [ "$(uname)" != "Darwin" ]; then
  echo "Only needed on macOS: on Windows/Linux, start YARG normally."; exit 0
fi

# 1. build the library (needs Xcode command line tools: xcode-select --install)
if [ ! -f "$LIB" ] || [ "$HERE/broadcast-fix.c" -nt "$LIB" ]; then
  if ! command -v clang >/dev/null 2>&1; then
    echo "clang not found. Install Apple's command line tools first:  xcode-select --install"; exit 1
  fi
  clang -dynamiclib -arch arm64 -arch x86_64 -O2 -o "$LIB" "$HERE/broadcast-fix.c"
  echo "Built $LIB"
fi

# 2. find YARG.app: argument, last one used, the running copy, or the usual install places (newest wins)
APP="$1"
running_app() { pgrep -x YARG >/dev/null 2>&1 && ps -o command= -p "$(pgrep -x YARG | head -1)" | sed 's|/Contents/MacOS/YARG.*||'; }
[ -z "$APP" ] && APP="$(running_app || true)"
[ -z "$APP" ] && [ -f "$SAVED" ] && APP="$(cat "$SAVED")"
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  APP="$(ls -dt /Applications/YARG.app "$HOME"/Applications/YARG.app \
    /Volumes/*/*/YARG\ Installs/*/installation/YARG.app /Volumes/*/YARG\ Installs/*/installation/YARG.app \
    "$HOME"/*/YARG\ Installs/*/installation/YARG.app "$HOME"/YARG\ Installs/*/installation/YARG.app 2>/dev/null | head -1 || true)"
fi
if [ -z "$APP" ] || [ ! -x "$APP/Contents/MacOS/YARG" ]; then
  echo "Couldn't find YARG.app. Run once with its path, e.g.:"
  echo "  npm run yarg -- \"/Volumes/Drive/YARG Installs/<id>/installation/YARG.app\""
  exit 1
fi
echo "$APP" > "$SAVED"

# 3. YARG must be started fresh for the library to load
if pgrep -x YARG >/dev/null 2>&1; then
  echo "YARG is running. Quit it first (the fix only applies when YARG starts), then run this again."; exit 1
fi
echo "Starting $APP"
DYLD_INSERT_LIBRARIES="$LIB" nohup "$APP/Contents/MacOS/YARG" >/dev/null 2>&1 &
echo "Done. In YARG, make sure Settings > All Settings > Experimental > Enable UDP Data Stream is on."
