#!/usr/bin/env bash
# Runs the bot and the web panel side by side in one container.
#   bot:   public, on $PORT (Cloud Run's port). Handles /telegram, /jobs/*, /health and passes
#          everything else to the panel.
#   panel: internal only, on 127.0.0.1:3000 (PANEL_PORT in src/lib/panel-proxy.ts).
# If either process exits, the other is stopped and the container exits, so Cloud Run restarts it
# cleanly instead of running half a service.
set -u

cd /app/web && PORT=3000 HOSTNAME=127.0.0.1 node server.js &
panel=$!

cd /app && bun src/index.ts &
bot=$!

# Cloud Run sends SIGTERM on every deploy/scale-down. Pass it on: the bot releases its locks and
# reports an interrupted scan (see shutdown in src/index.ts).
stop() {
  kill -TERM "$bot" "$panel" 2>/dev/null
  wait
  exit 0
}
trap stop TERM INT

wait -n "$bot" "$panel"
code=$?
echo "one of the processes exited ($code); stopping the container" >&2
kill -TERM "$bot" "$panel" 2>/dev/null
wait
exit "$code"
