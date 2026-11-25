#!/bin/sh
# Start YARG with its UDP Data Stream working on macOS (so yargDash follows the song).
#
#   npm run yarg                    # or double-click "yarg/Start YARG.command"
#   npm run yarg -- "/path/to/YARG.app"   # first time, if YARG isn't found automatically
#   npm run yarg -- --restart       # YARG already running without the fix: quit it and start it again with it
#   YARGDASH_STREAM_LOCAL=1 npm run yarg   # send the stream to this Mac only (127.0.0.1), see broadcast-fix.c
#
# Loads yarg-broadcast.dylib into YARG (see broadcast-fix.c). YARG itself is not modified.
# Also turn on YARG's Settings > All Settings > Experimental > Enable UDP Data Stream (once).
#
# The desktop app runs this with YARGDASH_LIB (its prebuilt library) and YARGDASH_STATE (a writable folder).
# Exit codes: 2 = YARG.app not found, 3 = YARG is already running.
set -e
RESTART=
if [ "$1" = "--restart" ]; then RESTART=1; shift; fi
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="${YARGDASH_STATE:-$HERE/build}"
LIB="${YARGDASH_LIB:-$STATE/yarg-broadcast.dylib}"
SAVED="$STATE/yarg-app-path"
mkdir -p "$STATE"

if [ "$(uname)" != "Darwin" ]; then
  echo "Only needed on macOS: on Windows/Linux, start YARG normally."; exit 0
fi

# 1. build the library (needs Xcode command line tools: xcode-select --install)
if [ -z "$YARGDASH_LIB" ] && { [ ! -f "$LIB" ] || [ "$HERE/broadcast-fix.c" -nt "$LIB" ]; }; then
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
  exit 2
fi
echo "$APP" > "$SAVED"

# 3. YARG must be started fresh for the library to load
if pgrep -x YARG >/dev/null 2>&1; then
  if [ -z "$RESTART" ]; then
    echo "YARG is running. Quit it first (the fix only applies when YARG starts), then run this again."; exit 3
  fi
  echo "Quitting YARG"
  pkill -TERM -x YARG || true
  i=0
  while pgrep -x YARG >/dev/null 2>&1 && [ $i -lt 40 ]; do sleep 0.5; i=$((i + 1)); done
  if pgrep -x YARG >/dev/null 2>&1; then
    echo "YARG didn't quit. Quit it yourself, then try again."; exit 3
  fi
  sleep 1
fi
echo "Starting $APP"
# Through `open` (Launch Services), with the library passed by --env, so that:
#  - YARG runs as itself: started from the yargDash app it would otherwise count as part of the app for macOS's
#    privacy checks and get the app's Local Network permission instead of its own (its broadcasts then fail)
#  - DYLD_INSERT_LIBRARIES reaches YARG: macOS wipes DYLD_* variables when it starts a system program (nohup, env)
#  - YARG keeps running after this script and its terminal are gone
# YARGDASH_STREAM_LOCAL=1: "this Mac only", the stream goes to 127.0.0.1 (see broadcast-fix.c)
if [ "$YARGDASH_STREAM_LOCAL" = "1" ]; then
  open -a "$APP" --env "DYLD_INSERT_LIBRARIES=$LIB" --env "YARGDASH_STREAM_LOCAL=1"
else
  open -a "$APP" --env "DYLD_INSERT_LIBRARIES=$LIB"
fi
echo "Done. In YARG, make sure Settings > All Settings > Experimental > Enable UDP Data Stream is on."
