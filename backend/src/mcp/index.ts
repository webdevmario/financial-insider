import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createServer } from "./server.js";

/**
 * `pnpm mcp` / the installed launcher: the finance MCP over stdio. stdout is
 * the protocol, so logs go to stderr as JSON lines.
 *
 * Env: FINANCE_DB_PATH (default: data/finance.db in this repo, when run from source).
 *
 * Uses Node's built-in node:sqlite rather than better-sqlite3 so the bundle has
 * no native module and runs from anywhere. The connection is read-only: SQLite
 * refuses any write, whatever a tool asks for.
 */

const log = (entry: Record<string, unknown>) =>
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.FINANCE_DB_PATH || resolve(here, "../../../data/finance.db");
if (!existsSync(dbPath)) {
  log({ level: "error", msg: "finance database not found; set FINANCE_DB_PATH", dbPath });
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
// The app writes while we read; wait out a write lock instead of failing
db.exec("PRAGMA busy_timeout = 3000");

const handle = serveStdio(() => createServer({ db, log }));
log({ level: "info", msg: "financial-insider mcp started", dbPath });

async function shutdown() {
  await handle.close().catch(() => {});
  db.close();
  process.exit(0);
}
process.stdin.on("end", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
