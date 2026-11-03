import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(__dirname, "../../../data/finance.db");

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
  )
`);

export const db = drizzle(sqlite, { schema });
export { sqlite };
