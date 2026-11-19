#!/bin/bash
#
# What the daily-copy launchd job runs (scripts/db_backup.plist.template), and
# the command to make a copy by hand: copy the app's database into
# <data folder>/backups, check the copy, keep the last 14. Prints the copy it
# made and its size; exits non-zero, saying why, when it could not.

set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
exec node --disable-warning=ExperimentalWarning "$REPO/scripts/db.ts" backup
