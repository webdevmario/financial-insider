/**
 * Statement importer: CSV text → transactions, plus the statements-folder scan.
 *
 * Drop CSVs anywhere under the statements folder (default ~/Documents/finance-statements,
 * override with STATEMENTS_DIR). Files are never moved or changed: each file's sha256 is
 * recorded, so a scan skips files it has already imported and re-downloads that overlap
 * old ones only add the transactions that are new.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, join, relative, resolve } from "path";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "../../db/index.js";
import { importBatches, payees, statementAccounts, transactions, type Transaction } from "../../db/schema.js";
import { today } from "../date.js";
import { parseStatement, UnrecognizedFormatError } from "./formats.js";
import { recomputeAll } from "./payees.js";

export function statementsDir(): string {
  return resolve(process.env.STATEMENTS_DIR || join(homedir(), "Documents", "finance-statements"));
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface ImportResult {
  batchId: string;
  fileName: string;
  format: string;
  accountId: string;
  accountName: string;
  rowCount: number;
  inserted: number;
  duplicates: number;
  dateFrom: string | null;
  dateTo: string | null;
}

// ── Import ────────────────────────────────────────────────────────

export function importCsv(text: string, fileName: string, sourcePath: string | null = null): ImportResult {
  const parsed = parseStatement(text, fileName);
  const { account, rows } = parsed;
  const now = new Date().toISOString();
  const batchId = newId();

  // Identical rows in one file (two $5 coffees the same day) get an occurrence number,
  // so they stay separate here but still match the same rows in an overlapping download
  const seen = new Map<string, number>();
  const records = rows.map((row) => {
    const key = `${account.id}|${row.date}|${row.amount.toFixed(2)}|${row.description}|${row.uniq}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return {
      id: sha256(`${key}|${n}`).slice(0, 24),
      accountId: account.id,
      batchId,
      date: row.date,
      postedDate: row.postedDate,
      month: row.date.slice(0, 7),
      amount: row.amount,
      description: row.description,
      merchant: row.merchant,
      category: row.category,
      kind: row.kind,
      member: row.member,
      transferPeerId: null,
      edited: 0,
      baseMerchant: row.merchant,
      baseCategory: row.category,
      baseKind: row.kind,
      payeeId: null,
      aliasId: null,
      payeeLocked: 0,
      raw: JSON.stringify(row.raw),
      createdAt: now,
    };
  });

  const dates = records.map((r) => r.date).sort();
  let inserted = 0;

  db.transaction((tx) => {
    tx.insert(statementAccounts)
      .values({ ...account, createdAt: today() })
      .onConflictDoNothing()
      .run();
    for (const r of records) {
      inserted += tx.insert(transactions).values(r).onConflictDoNothing().run().changes;
    }
    tx.insert(importBatches)
      .values({
        id: batchId,
        fileName,
        sourcePath,
        fileHash: sha256(text),
        status: "imported",
        format: parsed.format,
        accountId: account.id,
        rowCount: records.length,
        inserted,
        duplicates: records.length - inserted,
        dateFrom: dates[0] ?? null,
        dateTo: dates[dates.length - 1] ?? null,
        importedAt: now,
      })
      .run();
  });

  // Payees first (they can say what is or isn't a transfer), then pair transfers
  recomputeAll();
  pairTransfers();

  const name = db.select().from(statementAccounts).where(eq(statementAccounts.id, account.id)).get()?.name;
  return {
    batchId,
    fileName,
    format: parsed.format,
    accountId: account.id,
    accountName: name || account.name,
    rowCount: records.length,
    inserted,
    duplicates: records.length - inserted,
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null,
  };
}

/** Remove the transactions a batch added; the folder scan then skips that file */
export function undoBatch(batchId: string): number {
  let removed = 0;
  db.transaction((tx) => {
    const ids = tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.batchId, batchId)).all().map((r) => r.id);
    if (ids.length) {
      // Unpair whatever these were paired with
      tx.update(transactions).set({ transferPeerId: null }).where(inArray(transactions.transferPeerId, ids)).run();
      removed = tx.delete(transactions).where(eq(transactions.batchId, batchId)).run().changes;
    }
    tx.update(importBatches).set({ status: "undone" }).where(eq(importBatches.id, batchId)).run();
  });
  pairTransfers();
  return removed;
}

/** Forget an undone batch so the next scan imports its file again */
export function forgetBatch(batchId: string) {
  db.delete(importBatches).where(and(eq(importBatches.id, batchId), eq(importBatches.status, "undone"))).run();
}

// ── Transfers between your own accounts ───────────────────────────

const PAIR_WINDOW_DAYS = 6;
/** A row not already marked as a transfer is only paired if it reads like one (never a restaurant that happens to match) */
const PAYMENT_LIKE = /PAYMENT|PMT|PYMT|EPAY|AUTOPAY|AUTO PAY|ACH|TRANSFER|XFER/i;

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/**
 * Pair each unpaired transfer (a card's "payment received", a checking "transfer")
 * with the opposite, same-amount row in another account a few days apart, e.g.
 * Ally −$512.30 "APPLECARD GSBANK PAYMENT" ↔ Apple Card +$512.30 "Payment".
 * The other side becomes a transfer too, so neither counts as spending or income.
 * Rows changed by hand or by a rule keep their kind unless they're already transfers.
 */
export function pairTransfers(): number {
  const open = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.transferPeerId), ne(transactions.kind, "refund")))
    .all();

  const byAmount = new Map<string, Transaction[]>();
  for (const t of open) {
    const k = Math.abs(t.amount).toFixed(2);
    (byAmount.get(k) ?? byAmount.set(k, []).get(k)!).push(t);
  }

  // A payee that says "this is spending" (or income…) keeps its rows out of pairing
  const notTransfer = new Set(
    db.select().from(payees).all().filter((p) => p.kind && p.kind !== "transfer").map((p) => p.id)
  );
  const used = new Set<string>();
  const pairs: [Transaction, Transaction][] = [];
  const anchors = open.filter((t) => t.kind === "transfer").sort((a, b) => a.date.localeCompare(b.date));

  for (const a of anchors) {
    if (used.has(a.id)) continue;
    const candidates = (byAmount.get(Math.abs(a.amount).toFixed(2)) ?? []).filter(
      (b) =>
        !used.has(b.id) &&
        b.id !== a.id &&
        b.accountId !== a.accountId &&
        Math.sign(b.amount) === -Math.sign(a.amount) &&
        Math.abs(dayNumber(b.date) - dayNumber(a.date)) <= PAIR_WINDOW_DAYS &&
        (b.kind === "transfer" || (!b.edited && !(b.payeeId && notTransfer.has(b.payeeId)) && PAYMENT_LIKE.test(b.description)))
    );
    if (!candidates.length) continue;
    // Prefer rows already marked as transfers, then the closest date
    candidates.sort(
      (x, y) =>
        Number(y.kind === "transfer") - Number(x.kind === "transfer") ||
        Math.abs(dayNumber(x.date) - dayNumber(a.date)) - Math.abs(dayNumber(y.date) - dayNumber(a.date))
    );
    const b = candidates[0];
    used.add(a.id);
    used.add(b.id);
    pairs.push([a, b]);
  }

  if (pairs.length) {
    db.transaction((tx) => {
      for (const [a, b] of pairs) {
        tx.update(transactions).set({ transferPeerId: b.id }).where(eq(transactions.id, a.id)).run();
        tx.update(transactions)
          .set({ transferPeerId: a.id, kind: "transfer", category: "Transfer" })
          .where(eq(transactions.id, b.id))
          .run();
      }
    });
  }
  return pairs.length;
}

// ── Statements folder ─────────────────────────────────────────────

export interface ScanResult {
  scannedAt: string;
  folder: string;
  imported: ImportResult[];
  skipped: number; // Already imported (or undone)
  unrecognized: { file: string; error: string }[];
}

let lastScan: ScanResult | null = null;
let scanning = false;

export function lastScanResult() {
  return lastScan;
}

/** CSV files under the folder, a few levels deep, skipping hidden files and partial downloads */
function listCsvFiles(dir: string, depth = 0): string[] {
  if (depth > 3 || !existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listCsvFiles(full, depth + 1));
    else if (entry.isFile() && /\.csv$/i.test(entry.name)) out.push(full);
  }
  return out.sort();
}

/** `fresh: true` skips the "still downloading" check, for a file we just wrote ourselves */
export function scanStatements({ fresh = false } = {}): ScanResult {
  const folder = statementsDir();
  const result: ScanResult = { scannedAt: new Date().toISOString(), folder, imported: [], skipped: 0, unrecognized: [] };
  if (scanning) return lastScan ?? result;
  scanning = true;
  try {
    mkdirSync(folder, { recursive: true });
    const known = new Set(db.select({ h: importBatches.fileHash }).from(importBatches).all().map((r) => r.h));
    for (const path of listCsvFiles(folder)) {
      // A file still being written by the browser: catch it on the next scan
      if (!fresh && Date.now() - statSync(path).mtimeMs < 1500) continue;
      const text = readFileSync(path, "utf8");
      const hash = sha256(text);
      if (known.has(hash)) {
        result.skipped++;
        continue;
      }
      try {
        result.imported.push(importCsv(text, basename(path), relative(folder, path)));
        known.add(hash);
      } catch (err) {
        result.unrecognized.push({
          file: relative(folder, path),
          error: err instanceof UnrecognizedFormatError ? err.message : `Import failed: ${(err as Error).message}`,
        });
      }
    }
    for (const r of result.imported) {
      console.log(`${new Date().toISOString()} Imported ${r.fileName}: ${r.inserted} new, ${r.duplicates} already had (${r.accountName})`);
    }
  } finally {
    scanning = false;
  }
  lastScan = result;
  return result;
}

/** Save an uploaded CSV into the folder's uploads/ subfolder and import it */
export function saveUpload(fileName: string, text: string): ScanResult {
  const dir = join(statementsDir(), "uploads");
  mkdirSync(dir, { recursive: true });
  const safe = basename(fileName).replace(/[^\w .()-]/g, "_") || "upload.csv";
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  writeFileSync(join(dir, `${stamp} ${/\.csv$/i.test(safe) ? safe : `${safe}.csv`}`), text);
  return scanStatements({ fresh: true });
}

/**
 * Scan on startup, then whenever something changes in the folder (debounced, so a
 * download that lands in several writes is read once it's finished).
 * Set STATEMENTS_WATCH=0 to turn this off.
 */
export function watchStatements() {
  if (process.env.STATEMENTS_WATCH === "0") return;
  const folder = statementsDir();
  try {
    mkdirSync(folder, { recursive: true });
  } catch (err) {
    console.error(`Statements folder unavailable (${folder}): ${(err as Error).message}`);
    return;
  }
  const run = () => {
    try {
      scanStatements();
    } catch (err) {
      console.error(`${new Date().toISOString()} Statements scan failed: ${(err as Error).message}`);
    }
  };
  let timer: NodeJS.Timeout | null = null;
  const schedule = (delay: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delay);
  };
  try {
    watch(folder, { recursive: true }, () => schedule(3000));
    console.log(`  📂 Watching statements folder: ${folder}`);
  } catch (err) {
    console.error(`Can't watch ${folder}: ${(err as Error).message}`);
  }
  schedule(500);
}
