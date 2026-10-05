#!/bin/bash
# Asks the running Body Lab server to shut down.
PORT="${BODYLAB_PORT:-4185}"
URL="http://127.0.0.1:$PORT"

page="$(curl -s --max-time 2 "$URL/")" || { echo "Body Lab is not running."; exit 0; }
case "$page" in
  *"Body Lab"*) ;;
  *) echo "Something other than Body Lab is using port $PORT. Nothing was stopped."; exit 1 ;;
esac

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST -H 'Content-Type: application/json' -d '{}' "$URL/api/shutdown")"
if [ "$code" = "200" ] || [ "$code" = "204" ]; then
  echo "Body Lab stopped."
else
  echo "Body Lab refused to stop (HTTP $code)."
  exit 1
fi
