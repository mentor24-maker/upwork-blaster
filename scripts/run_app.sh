#!/bin/bash
#
# What the app's launchd service runs (scripts/app_service.plist.template):
# build the app if the checkout has moved since the last build, then serve it
# on every address of this machine, so any device on the home network can
# open it. launchd starts this again whenever it stops.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${APP_PORT:-4280}"
STAMP="$REPO/.next/BUILT_FROM"
cd "$REPO"

say() { echo "[app] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

head_now="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
if [ ! -f "$REPO/.next/BUILD_ID" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$head_now" ]; then
  say "building from $head_now"
  if ! npm run --silent build; then
    say "BUILD FAILED — not starting; launchd tries again shortly"
    exit 1
  fi
  echo "$head_now" > "$STAMP"
fi

# Bring the database up to date before serving (lib/db.ts). A migration that
# fails stops the start, so the app never runs against a half-made database.
if ! node --disable-warning=ExperimentalWarning "$REPO/scripts/db.ts" migrate; then
  say "DATABASE MIGRATION FAILED — not starting; launchd tries again shortly"
  exit 1
fi

say "starting on port $PORT"
# The app's password and cookie key (APP_PASSWORD, APP_SESSION_SECRET) live in
# Doppler; `doppler run` hands them to the app without them touching a file or
# this log. Without them the app still starts, and lets nobody in.
DOPPLER_PROJECT="$(node "$REPO/scripts/project_config.mjs" dopplerProject)"
DOPPLER_CONFIG="$(node "$REPO/scripts/project_config.mjs" dopplerConfig)"
exec doppler run --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG" --no-check-version -- \
  node "$REPO/node_modules/next/dist/bin/next" start -H 0.0.0.0 -p "$PORT"
