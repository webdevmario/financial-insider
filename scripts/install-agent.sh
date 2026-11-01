#!/bin/bash
# Install (or reinstall) one of the LaunchAgents in scripts/launchd/:
#   ./scripts/install-agent.sh com.financial-insider-backup
#   ./scripts/install-agent.sh com.financial-insider-backup --uninstall
# launchd can't expand ~ in log paths, so __LOG_DIR__ is filled in here.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="${1:?usage: install-agent.sh <label> [--uninstall]}"
SRC="$ROOT/scripts/launchd/$LABEL.plist"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/financial-insider"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN" "$DEST" 2>/dev/null || true

if [ "${2:-}" = "--uninstall" ]; then
  rm -f "$DEST"
  echo "Uninstalled $LABEL"
  exit 0
fi

[ -f "$SRC" ] || { echo "No template at $SRC" >&2; exit 1; }
mkdir -p "$LOG_DIR"
sed "s|__LOG_DIR__|$LOG_DIR|g" "$SRC" > "$DEST"
plutil -lint "$DEST" >/dev/null
launchctl bootstrap "$DOMAIN" "$DEST"
echo "Installed $LABEL (logs in $LOG_DIR)"
