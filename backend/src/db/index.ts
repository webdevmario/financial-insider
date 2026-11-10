import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// DB_PATH lets a test run point at a scratch database instead of the real one
const dbPath = process.env.DB_PATH || resolve(__dirname, "../../../data/finance.db");

const sqlite = new Database(dbPath);

// Performance pragmas for SQLite
sqlite.pragma("journal_mode = WAL"); // Better concurrent read performance
sqlite.pragma("foreign_keys = ON");

// Lightweight migrations for columns added after `db:push`, so a plain restart
// picks them up without a manual schema push
const expenseCols = sqlite
  .prepare("PRAGMA table_info(expenses)")
  .all() as { name: string }[];
if (expenseCols.length && !expenseCols.some((c) => c.name === "updated_at")) {
  sqlite.exec("ALTER TABLE expenses ADD COLUMN updated_at TEXT");
}

// Columns added to transactions for payees
const txnCols = sqlite.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
if (txnCols.length) {
  for (const [col, type] of [
    ["base_merchant", "TEXT"], ["base_category", "TEXT"], ["base_kind", "TEXT"],
    ["payee_id", "TEXT"], ["alias_id", "TEXT"], ["payee_locked", "INTEGER DEFAULT 0 NOT NULL"],
  ]) {
    if (!txnCols.some((c) => c.name === col)) sqlite.exec(`ALTER TABLE transactions ADD COLUMN ${col} ${type}`);
  }
}

// Bill state (paused / cancelled), kept apart from the Essential / Review tag
const subCols = sqlite.prepare("PRAGMA table_info(subscriptions)").all() as { name: string }[];
if (subCols.length) {
  for (const col of ["state", "state_since", "amount_mode"]) {
    if (!subCols.some((c) => c.name === col)) sqlite.exec(`ALTER TABLE subscriptions ADD COLUMN ${col} TEXT`);
  }
}

// Tables added after the initial `db:push`
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    target_amount REAL DEFAULT 0 NOT NULL,
    saved_amount REAL DEFAULT 0 NOT NULL,
    deadline TEXT,
    priority TEXT DEFAULT 'medium' NOT NULL,
    notes TEXT,
    history TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS statement_accounts (
    id TEXT PRIMARY KEY NOT NULL,
    institution TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    last4 TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY NOT NULL,
    file_name TEXT NOT NULL,
    source_path TEXT,
    file_hash TEXT NOT NULL,
    status TEXT DEFAULT 'imported' NOT NULL,
    format TEXT NOT NULL,
    account_id TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    inserted INTEGER NOT NULL,
    duplicates INTEGER NOT NULL,
    date_from TEXT,
    date_to TEXT,
    imported_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    date TEXT NOT NULL,
    posted_date TEXT,
    month TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT NOT NULL,
    merchant TEXT NOT NULL,
    category TEXT DEFAULT 'Uncategorized' NOT NULL,
    kind TEXT NOT NULL,
    member TEXT,
    transfer_peer_id TEXT,
    edited INTEGER DEFAULT 0 NOT NULL,
    base_merchant TEXT,
    base_category TEXT,
    base_kind TEXT,
    payee_id TEXT,
    alias_id TEXT,
    payee_locked INTEGER DEFAULT 0 NOT NULL,
    raw TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS transactions_month ON transactions(month);
  CREATE INDEX IF NOT EXISTS transactions_account_date ON transactions(account_id, date);
  CREATE INDEX IF NOT EXISTS transactions_batch ON transactions(batch_id);
  CREATE INDEX IF NOT EXISTS import_batches_hash ON import_batches(file_hash);

  CREATE INDEX IF NOT EXISTS transactions_payee ON transactions(payee_id);

  CREATE TABLE IF NOT EXISTS payees (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    kind TEXT,
    bill_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payee_aliases (
    id TEXT PRIMARY KEY NOT NULL,
    payee_id TEXT NOT NULL,
    pattern TEXT NOT NULL,
    match TEXT DEFAULT 'contains' NOT NULL,
    amount REAL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS payee_aliases_payee ON payee_aliases(payee_id);

  CREATE TABLE IF NOT EXISTS merchant_rules (
    id TEXT PRIMARY KEY NOT NULL,
    pattern TEXT NOT NULL,
    merchant TEXT,
    category TEXT,
    kind TEXT,
    created_at TEXT NOT NULL
  );
`);

export const db = drizzle(sqlite, { schema });
export { sqlite };
