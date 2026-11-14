#!/usr/bin/env bash
# Builds the finance MCP and installs it outside ~/Documents, where Claude Desktop is allowed to run it
# (macOS keeps apps out of ~/Documents unless granted access). Claude Code and Claude Desktop both point at
# the installed launcher, so they run what was last deployed. `pnpm prod:deploy` runs this.
#
#   ~/Library/Application Support/financial-insider-mcp/
#     mcp.sh            launcher (sources nvm: Desktop has no shell PATH)
#     finance-mcp.mjs   the bundle (backend/dist/mcp/finance-mcp.mjs)
#
# The launcher points FINANCE_DB_PATH at this repo's data/finance.db, opened read-only.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${FINANCE_MCP_DIR:-$HOME/Library/Application Support/financial-insider-mcp}"
DB_PATH="${FINANCE_DB_PATH:-$PROJECT_DIR/data/finance.db}"

cd "$PROJECT_DIR"
[ -f "$DB_PATH" ] || { echo "No database at $DB_PATH" >&2; exit 1; }
node backend/scripts/build-mcp.mjs

mkdir -p "$DEST"
chmod 700 "$DEST"

# The DB path is baked in quoted with printf %q, so spaces survive
{
  echo '#!/usr/bin/env bash'
  echo '# Installed by financial-insider/scripts/install-mcp.sh; rerun that (pnpm mcp:install) instead of editing this.'
  echo '# stdout is the MCP protocol: nothing else may print to it.'
  echo 'set -euo pipefail'
  echo 'HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"'
  echo 'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"'
  echo '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1'
  printf 'export FINANCE_DB_PATH=%q\n' "$DB_PATH"
  echo 'exec node "$HERE/finance-mcp.mjs"'
} > "$DEST/mcp.sh.tmp"
chmod 755 "$DEST/mcp.sh.tmp"
mv "$DEST/mcp.sh.tmp" "$DEST/mcp.sh"

# Replace the bundle atomically: a running server keeps its open copy; the next start gets the new one.
cp backend/dist/mcp/finance-mcp.mjs "$DEST/finance-mcp.mjs.tmp"
mv "$DEST/finance-mcp.mjs.tmp" "$DEST/finance-mcp.mjs"

echo "Installed the finance MCP ($(git rev-parse --short HEAD)) in $DEST"
