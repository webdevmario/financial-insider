/**
 * Backup script: snapshots the live database into data/backups/finance-YYYYMMDD.db
 * and keeps the newest 30 daily snapshots.
 *
 * Usage: pnpm backup:now (or scripts/backup-db.sh). Runs daily at 3 AM via the
 * com.financial-insider-backup LaunchAgent.
 *
 * Uses SQLite's online backup API (not a file copy) so writes still in the WAL
 * are included and the snapshot is consistent while the server is running.
 * Safe to re-run: a second run on the same day replaces that day's file.
 *
 * This is Node rather than a shell script because launchd jobs need macOS
 * privacy access to ~/Documents, and node already has it for the server.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { today } from "../lib/date.js";

const KEEP = 30;
const DAILY = /^finance-\d{8}\.db$/;

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(__dirname, "../../../data/finance.db");
const backupDir = resolve(__dirname, "../../../data/backups");

function log(msg: string) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

function removeWithSidecars(path: string) {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(path + suffix, { force: true });
}

async function main() {
  if (!existsSync(dbPath)) throw new Error(`database not found at ${dbPath}`);
  mkdirSync(backupDir, { recursive: true });

  const dest = resolve(backupDir, `finance-${today().replaceAll("-", "")}.db`);
  const tmp = `${dest}.tmp`;
  removeWithSidecars(tmp);

  const source = new Database(dbPath, { fileMustExist: true });
  try {
    await source.backup(tmp);
  } finally {
    source.close();
  }

  // Make the snapshot a single self-contained file (no -wal/-shm sidecars), then verify it
  const copy = new Database(tmp);
  let check: unknown;
  try {
    copy.pragma("journal_mode = DELETE");
    check = copy.pragma("integrity_check", { simple: true });
  } finally {
    copy.close();
  }
  if (check !== "ok") {
    removeWithSidecars(tmp);
    throw new Error(`integrity check failed: ${check}`);
  }

  renameSync(tmp, dest);
  removeWithSidecars(tmp);
  log(`Backup written: ${dest} (${Math.round(statSync(dest).size / 1024)} KB)`);

  // Rolling retention: only daily files are pruned, so named snapshots like
  // finance-predeploy-*.db are never touched
  const daily = readdirSync(backupDir).filter((f) => DAILY.test(f)).sort().reverse();
  for (const old of daily.slice(KEEP)) {
    rmSync(resolve(backupDir, old), { force: true });
    log(`Pruned: ${old}`);
  }
}

main().catch((err) => {
  console.error(`${new Date().toISOString()} ERROR: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
