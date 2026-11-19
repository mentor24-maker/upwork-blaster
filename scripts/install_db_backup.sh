#!/bin/bash
#
# Install (or remove) the launchd job that makes the daily copy of the
# Upwork Blaster database on THIS machine (the Mini).
#
#   ./scripts/install_db_backup.sh               # install it, then make one copy now to prove it works
#   ./scripts/install_db_backup.sh --status      # installed? loaded? the newest copy?
#   ./scripts/install_db_backup.sh --uninstall   # remove it from here
#   ./scripts/install_db_backup.sh --print-plist # print the filled-in plist, change nothing
#
# The label is <launchdPrefix>.db-backup and the log is
# <logDir>/<projectSlug>-db-backup.log, from spirality.project.json, beside the
# app's own service.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHD_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

config_value() { PATH="$LAUNCHD_PATH:$PATH" node "$REPO/scripts/project_config.mjs" "$1"; }
PREFIX="$(config_value launchdPrefix)"
LOG_DIR="$(config_value logDir)"
SLUG="$(config_value projectSlug)"

LABEL="$PREFIX.db-backup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$LOG_DIR/$SLUG-db-backup.log"
BACKUPS="${UB_DATA_DIR:-$HOME/upwork-blaster-data}/backups"

# shellcheck source=lib/launchd_reload.sh
source "$REPO/scripts/lib/launchd_reload.sh"

render_plist() {
  sed -e "s|@@LABEL@@|$LABEL|g" \
      -e "s|@@REPO@@|$REPO|g" \
      -e "s|@@PATH@@|$LAUNCHD_PATH|g" \
      -e "s|@@LOG@@|$LOG|g" \
      "$REPO/scripts/db_backup.plist.template"
}

status() {
  local line newest
  echo "job:      $LABEL (daily at 3:15, from $REPO)"
  if [ -f "$PLIST" ]; then echo "installed: yes — $PLIST"; else echo "installed: no"; fi
  line="$(loaded_line "$LABEL")"
  if [ -z "$line" ]; then echo "loaded:   no"; else echo "loaded:   yes — $line"; echo "          (columns: PID, last exit code, label)"; fi
  newest="$(ls -1 "$BACKUPS"/app-*.sqlite 2>/dev/null | tail -1 || true)"
  if [ -n "$newest" ]; then
    echo "newest:   $newest ($(stat -f %z "$newest") bytes, $(date -r "$newest" '+%Y-%m-%d %H:%M'))"
    echo "copies:   $(ls -1 "$BACKUPS"/app-*.sqlite | wc -l | tr -d ' ') kept in $BACKUPS"
  else
    echo "newest:   none yet in $BACKUPS"
  fi
  if [ -f "$LOG" ]; then echo "log:      $LOG"; else echo "log:      $LOG (nothing written yet)"; fi
}

install() {
  mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
  render_plist > "$PLIST"
  if ! reload_job "$LABEL" "$PLIST"; then
    echo "FAILED: $LABEL is not loaded." >&2
    exit 1
  fi
  echo "installed: $LABEL — making one copy now to prove it works"
  PATH="$LAUNCHD_PATH:$PATH" bash "$REPO/scripts/run_db_backup.sh"
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
  echo "removed: $LABEL (the copies themselves are left in $BACKUPS)"
}

case "${1:-}" in
  "")            install ;;
  --status)      status ;;
  --uninstall)   uninstall ;;
  --print-plist) render_plist ;;
  *) echo "usage: $0 [--status | --uninstall | --print-plist]" >&2; exit 2 ;;
esac
