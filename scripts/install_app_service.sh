#!/bin/bash
#
# Install (or remove) the launchd service that keeps the Upwork Blaster app
# running on THIS machine (the Mini), at http://<this machine>:4280.
#
#   ./scripts/install_app_service.sh               # build the app, install and start the service
#   ./scripts/install_app_service.sh --status      # installed? loaded? running? answering?
#   ./scripts/install_app_service.sh --uninstall   # stop it and remove it from here
#   ./scripts/install_app_service.sh --print-plist # print the filled-in plist, change nothing
#
# Run it from the checkout the service should serve (on the Mini, the main
# checkout, which the loop keeps on the latest merged main). The label is
# <launchdPrefix>.app and the log is <logDir>/<projectSlug>-app.log, both from
# spirality.project.json, so it sits beside the loop's own jobs.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=4280
LAUNCHD_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

config_value() { PATH="$LAUNCHD_PATH:$PATH" node "$REPO/scripts/project_config.mjs" "$1"; }
PREFIX="$(config_value launchdPrefix)"
LOG_DIR="$(config_value logDir)"
SLUG="$(config_value projectSlug)"

LABEL="$PREFIX.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$LOG_DIR/$SLUG-app.log"
URL="http://127.0.0.1:$PORT/"

# shellcheck source=lib/launchd_reload.sh
source "$REPO/scripts/lib/launchd_reload.sh"

render_plist() {
  sed -e "s|@@LABEL@@|$LABEL|g" \
      -e "s|@@REPO@@|$REPO|g" \
      -e "s|@@PATH@@|$LAUNCHD_PATH|g" \
      -e "s|@@PORT@@|$PORT|g" \
      -e "s|@@LOG@@|$LOG|g" \
      "$REPO/scripts/app_service.plist.template"
}

answers() {
  curl -s --max-time 5 "$URL" 2>/dev/null | grep -q '<h1>Upwork Blaster</h1>'
}

status() {
  local line pid
  echo "service:  $LABEL (serves $REPO)"
  if [ -f "$PLIST" ]; then echo "installed: yes — $PLIST"; else echo "installed: no"; fi
  line="$(loaded_line "$LABEL")"
  if [ -z "$line" ]; then
    echo "loaded:   no"
    echo "running:  no"
  else
    echo "loaded:   yes — $line"
    echo "          (columns: PID, last exit code, label)"
    pid="$(awk '{print $1}' <<<"$line")"
    if [ "$pid" != "-" ]; then echo "running:  yes — pid $pid"; else echo "running:  no — launchd will start it again shortly"; fi
  fi
  if answers; then echo "answers:  yes — http://$(hostname -s).local:$PORT shows Upwork Blaster"
  else echo "answers:  NO — nothing answered as Upwork Blaster at $URL"; fi
  if [ -f "$LOG" ]; then echo "log:      $LOG (last modified $(date -r "$LOG" '+%Y-%m-%d %H:%M'))"
  else echo "log:      $LOG (nothing written yet)"; fi
}

install() {
  mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && [ -z "$(loaded_line "$LABEL")" ]; then
    echo "FAILED: something else is already listening on port $PORT:" >&2
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
    exit 1
  fi
  echo "building the app in $REPO ..."
  (cd "$REPO" && npm run --silent build) || { echo "FAILED: the build failed, so the service was not installed." >&2; exit 1; }
  git -C "$REPO" rev-parse HEAD > "$REPO/.next/BUILT_FROM" 2>/dev/null || true
  render_plist > "$PLIST"
  if ! reload_job "$LABEL" "$PLIST"; then
    echo "FAILED: $LABEL is not loaded." >&2
    exit 1
  fi
  # Read it back: the service is only installed once the page answers.
  local deadline=$(( SECONDS + 60 ))
  until answers; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "FAILED: $LABEL is loaded but nothing answered at $URL within 60s. See $LOG" >&2
      exit 1
    fi
    sleep 1
  done
  echo "installed: $LABEL"
  status
}

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  local deadline=$(( SECONDS + 30 ))
  while [ -n "$(loaded_line "$LABEL")" ]; do
    if [ "$SECONDS" -ge "$deadline" ]; then echo "FAILED: $LABEL is still loaded after 30s." >&2; exit 1; fi
    sleep 1
  done
  echo "removed: $LABEL"
}

case "${1:-}" in
  "")            install ;;
  --status)      status ;;
  --uninstall)   uninstall ;;
  --print-plist) render_plist ;;
  *) echo "usage: $0 [--status | --uninstall | --print-plist]" >&2; exit 2 ;;
esac
