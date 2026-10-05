#!/bin/bash
# Starts the Body Lab server if it is not already running, then opens the app window.
# It lives in App/Mac, so it moves up to the App folder first.
cd "$(dirname "$0")/.." || exit 1
PORT="${BODYLAB_PORT:-4185}"
URL="http://127.0.0.1:$PORT"
export BODYLAB_PORT="$PORT"

# Prints up (Body Lab answers), other (something else answers) or down.
port_state() {
  local page
  page="$(curl -s --max-time 2 "$URL/")" || { echo down; return; }
  case "$page" in
    *"Body Lab"*) echo up ;;
    *) echo other ;;
  esac
}

# Succeeds when node -v (for example v24.1.0) is 22.13 or newer.
node_ok() {
  local v major minor
  v="$(node -v 2>/dev/null)"
  v="${v#v}"
  major="${v%%.*}"
  minor="${v#*.}"
  minor="${minor%%.*}"
  case "$major$minor" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 13 ]; }
}

state="$(port_state)"
if [ "$state" = "other" ]; then
  echo "Something else is already using port $PORT, so Body Lab can't start there."
  exit 1
fi

if [ "$state" = "down" ]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js was not found. Install it from https://nodejs.org and try again."
    exit 1
  fi
  if ! node_ok; then
    echo "Body Lab needs Node 22.13 or newer. Install the LTS from https://nodejs.org."
    exit 1
  fi
  nohup node server.js >/dev/null 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    [ "$(port_state)" = "up" ] && break
    sleep 0.25
  done
fi

if [ "$(port_state)" != "up" ]; then
  echo "Body Lab did not start on port $PORT."
  exit 1
fi

# Only open a Body Lab that holds your own notes, never the made-up demo.
info="$(curl -s --max-time 2 "$URL/api/info")"
case "$info" in
  *'"demo":false'*) ;;
  *'"demo":true'*)
    echo "Port $PORT is running the Body Lab demo, not your own notes. Stop the demo first."
    exit 1 ;;
  *)
    echo "Something on port $PORT answers as Body Lab but didn't say whose notes it has. Stop it and try again."
    exit 1 ;;
esac

if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="$URL"
else
  open "$URL"
fi
