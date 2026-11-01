#!/bin/bash
# Snapshot the live database into data/backups/ (keeps the newest 30 daily files).
# The work happens in backend/src/db/backup.ts; see there for details.
set -euo pipefail

source ~/.nvm/nvm.sh
cd "$(dirname "$0")/../backend"
exec node --import tsx src/db/backup.ts
