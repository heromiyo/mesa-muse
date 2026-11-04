#!/bin/bash
# npm run tunnel — public https URL for the local server via a Cloudflare quick tunnel.
# Prints the URL; put it in .env as PUBLIC_URL, restart the server, then run npm run webhook.
set -euo pipefail
PORT="${PORT:-8787}"
LOG="$(mktemp)"
cloudflared tunnel --no-autoupdate --url "http://localhost:${PORT}" >"$LOG" 2>&1 &
for _ in $(seq 1 30); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  if [ -n "$URL" ]; then echo "$URL"; wait; exit 0; fi
  sleep 1
done
echo "tunnel did not start:" >&2; cat "$LOG" >&2; exit 1
