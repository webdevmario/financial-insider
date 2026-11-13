/**
 * Statement importer: CSV text → transactions, plus the statements-folder scan.
 *
 * Drop CSVs and PDF statements into the statements folder (default ~/Documents/finance-statements,
 * override with STATEMENTS_DIR), named anything. Each file's sha256 is recorded, so a scan skips
 * files it has already imported and re-downloads that overlap old ones only add the transactions
 * that are new. A file dropped at the top of the folder (or uploaded) is filed away once imported,
 * as <bank>/<year>/<first day> to <last day> <account>.csv; files in subfolders stay where they are.
 * File contents are never changed. Set STATEMENTS_ORGANIZE=0 to leave new files in place.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, watch, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, dirname, extname, join, relative, resolve, sep } from "path";
import { and, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { db } from "../../db/index.js";
import { importBatches, payees, statementAccounts, transactions, type Transaction } from "../../db/schema.js";
import { today } from "../date.js";
import { parseStatement, UnrecognizedFormatError, type AccountInfo, type ParsedRow } from "./formats.js";
import { extractPdfLines } from "./pdf.js";
import { parsePdfStatement, StatementCheckError, UnrecognizedPdfError } from "./pdfFormats.js";
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
  /** PDF rows skipped because a CSV already covers those days */
  covered?: number;
  /** PDF rows this CSV replaced */
  replaced?: number;
  dateFrom: string | null;
  dateTo: string | null;
}

// ── Import ────────────────────────────────────────────────────────

const isPdfFormat = (format: string) => format.endsWith("-pdf");

/** Date ranges an account's CSV imports cover; CSVs are the source of truth there */
function csvCoverage(accountId: string): [string, string][] {
  return db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.accountId, accountId), eq(importBatches.status, "imported")))
    .all()
    .filter((b) => !isPdfFormat(b.format) && b.dateFrom && b.dateTo)
    .map((b) => [b.dateFrom!, b.dateTo!]);
}

/** Rows from an account's CSV imports on the given days */
function csvRowsOn(accountId: string, dates: string[]): { date: string; amount: number }[] {
  if (!dates.length) return [];
  const csvBatches = db
    .select({ id: importBatches.id, format: importBatches.format })
    .from(importBatches)
    .where(and(eq(importBatches.accountId, accountId), eq(importBatches.status, "imported")))
    .all()
    .filter((b) => !isPdfFormat(b.format))
    .map((b) => b.id);
  if (!csvBatches.length) return [];
  return db
    .select({ date: transactions.date, amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), inArray(transactions.batchId, csvBatches), inArray(transactions.date, [...new Set(dates)])))
    .all();
}

/** Takes one row with the same date and amount out of `pool`, if there is one */
function claim(pool: { date: string; amount: number }[], row: { date: string; amount: number }): boolean {
  const i = pool.findIndex((p) => p.date === row.date && Math.abs(p.amount - row.amount) < 0.005);
  if (i < 0) return false;
  pool.splice(i, 1);
  return true;
}

/**
 * Amex prints a new account ending after a card is replaced, though it's the same account with
 * one continuous balance. With a single Amex account on file, statements for a new ending go there.
 */
function sameAccount(account: AccountInfo): AccountInfo {
  if (account.institution !== "Amex") return account;
  const amex = db.select().from(statementAccounts).where(eq(statementAccounts.institution, "Amex")).all();
  if (amex.length !== 1 || amex[0].id === account.id) return account;
  const a = amex[0];
  return { id: a.id, institution: a.institution, name: a.name, kind: a.kind as AccountInfo["kind"], last4: a.last4 };
}

export class AccountUnclearError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountUnclearError";
  }
}

const toInfo = (a: typeof statementAccounts.$inferSelect): AccountInfo => ({
  id: a.id,
  institution: a.institution,
  name: a.name,
  kind: a.kind as AccountInfo["kind"],
  last4: a.last4,
});

/**
 * A file that doesn't say which account it's for (a Chase CSV without the card number in its
 * name) goes to the account of that bank and type already on file. With several (two Chase
 * cards), it goes to the one that already has the most of its rows.
 */
function resolveAccount(account: AccountInfo, rows: ParsedRow[]): AccountInfo {
  if (account.last4) return account;
  if (db.select().from(statementAccounts).where(eq(statementAccounts.id, account.id)).get()) return account;
  const same = db
    .select()
    .from(statementAccounts)
    .where(and(eq(statementAccounts.institution, account.institution), eq(statementAccounts.kind, account.kind)))
    .all();
  if (!same.length) return account;
  if (same.length === 1) return toInfo(same[0]);

  const dates = rows.map((r) => r.date).sort();
  const mine = new Set(rows.map((r) => `${r.date}|${r.amount.toFixed(2)}|${r.description}`));
  const scored = same
    .map((a) => ({
      a,
      n: dates.length
        ? db
            .select({ date: transactions.date, amount: transactions.amount, description: transactions.description })
            .from(transactions)
            .where(and(eq(transactions.accountId, a.id), gte(transactions.date, dates[0]), lte(transactions.date, dates[dates.length - 1])))
            .all()
            .filter((t) => mine.has(`${t.date}|${t.amount.toFixed(2)}|${t.description}`)).length
        : 0,
    }))
    .sort((x, y) => y.n - x.n);
  if (scored[0].n > 0 && scored[0].n > (scored[1]?.n ?? 0)) return toInfo(scored[0].a);
  throw new AccountUnclearError(
    `Can't tell which ${account.institution} account this is (${same.map((a) => a.name).join(", ")}). ` +
      `Rename the file to start with the last 4 digits, e.g. ${account.institution}1234_${account.institution === "Chase" ? "Activity" : "export"}.csv`
  );
}

/**
 * Store one account's rows from one file as one import batch.
 * PDF rows inside a CSV-covered range are skipped; a CSV replaces PDF rows in its range,
 * so the result is the same whichever file arrives first.
 */
function storeRows(
  account: AccountInfo,
  format: string,
  rows: ParsedRow[],
  file: { fileName: string; sourcePath: string | null; fileHash: string }
): ImportResult {
  const now = new Date().toISOString();
  const batchId = newId();
  const fromPdf = isPdfFormat(format);
  const covered = fromPdf ? csvCoverage(account.id) : [];
  const inside = (d: string) => covered.some(([a, b]) => d >= a && d <= b);
  // A CSV's first and last day may be partial (a download that starts mid-day, a charge that posted
  // after the cutoff), so on those days a PDF row only gives way to a CSV row with the same amount
  const edge = (d: string) => inside(d) && !covered.some(([a, b]) => d > a && d < b);
  const onEdges = fromPdf ? csvRowsOn(account.id, rows.map((r) => r.date).filter(edge)) : [];
  const keep = fromPdf ? rows.filter((r) => !inside(r.date) || (edge(r.date) && !claim(onEdges, r))) : rows;

  // Identical rows in one file (two $5 coffees the same day) get an occurrence number,
  // so they stay separate here but still match the same rows in an overlapping download
  const seen = new Map<string, number>();
  const records = keep.map((row) => {
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

  const dates = rows.map((r) => r.date).sort();
  const dateFrom = dates[0] ?? null;
  const dateTo = dates[dates.length - 1] ?? null;
  let inserted = 0;
  let replaced = 0;

  db.transaction((tx) => {
    tx.insert(statementAccounts).values({ ...account, createdAt: today() }).onConflictDoNothing().run();
    if (!fromPdf && dateFrom && dateTo) {
      // This CSV supersedes rows read from PDF statements for the same days
      const pdfBatches = tx
        .select({ id: importBatches.id, format: importBatches.format })
        .from(importBatches)
        .where(eq(importBatches.accountId, account.id))
        .all()
        .filter((b) => isPdfFormat(b.format))
        .map((b) => b.id);
      if (pdfBatches.length) {
        // Whole days inside the CSV's range go; on its first and last day only the rows it also has
        const mine = keep.map((r) => ({ date: r.date, amount: r.amount }));
        const stale = tx
          .select({ id: transactions.id, date: transactions.date, amount: transactions.amount })
          .from(transactions)
          .where(and(eq(transactions.accountId, account.id), inArray(transactions.batchId, pdfBatches), gte(transactions.date, dateFrom), lte(transactions.date, dateTo)))
          .all()
          .filter((r) => (r.date !== dateFrom && r.date !== dateTo) || claim(mine, r))
          .map((r) => r.id);
        if (stale.length) {
          tx.update(transactions).set({ transferPeerId: null }).where(inArray(transactions.transferPeerId, stale)).run();
          replaced = tx.delete(transactions).where(inArray(transactions.id, stale)).run().changes;
        }
      }
    }
    for (const r of records) inserted += tx.insert(transactions).values(r).onConflictDoNothing().run().changes;
    tx.insert(importBatches)
      .values({
        id: batchId,
        fileName: file.fileName,
        sourcePath: file.sourcePath,
        fileHash: file.fileHash,
        status: "imported",
        format,
        accountId: account.id,
        rowCount: rows.length,
        inserted,
        duplicates: rows.length - inserted,
        dateFrom,
        dateTo,
        importedAt: now,
      })
      .run();
  });

  const name = db.select().from(statementAccounts).where(eq(statementAccounts.id, account.id)).get()?.name;
  return {
    batchId,
    fileName: file.fileName,
    format,
    accountId: account.id,
    accountName: name || account.name,
    rowCount: rows.length,
    inserted,
    duplicates: rows.length - inserted,
    covered: rows.length - keep.length,
    replaced,
    dateFrom,
    dateTo,
  };
}

/** Payees first (they can say what is or isn't a transfer), then pair transfers */
function settle() {
  recomputeAll();
  pairTransfers();
}

export function importCsv(text: string, fileName: string, sourcePath: string | null = null): ImportResult {
  const parsed = parseStatement(text, fileName);
  const result = storeRows(resolveAccount(parsed.account, parsed.rows), parsed.format, parsed.rows, { fileName, sourcePath, fileHash: sha256(text) });
  settle();
  return result;
}

/** One PDF statement can hold several accounts (Ally: checking + savings): one batch each */
export async function importPdf(data: Uint8Array, fileName: string, sourcePath: string | null, fileHash: string): Promise<ImportResult[]> {
  const parsed = parsePdfStatement(await extractPdfLines(data));
  const results = parsed.sections.map((s) =>
    storeRows(sameAccount(resolveAccount(s.account, s.rows)), parsed.format, s.rows, {
      fileName: parsed.sections.length > 1 ? `${fileName} · ${s.account.name}` : fileName,
      sourcePath,
      fileHash,
    })
  );
  settle();
  return results;
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
let rescanWanted = false;

export function lastScanResult() {
  return lastScan;
}

/** Statement files (CSV, PDF) under the folder, a few levels deep, skipping hidden files */
function listStatementFiles(dir: string, depth = 0): string[] {
  if (depth > 3 || !existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listStatementFiles(full, depth + 1));
    else if (entry.isFile() && /\.(csv|pdf)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

const isPdfPath = (p: string) => /\.pdf$/i.test(p);

/**
 * Import every file not seen before. CSVs go first: where a CSV and a PDF statement cover
 * the same days, the CSV is the source of truth. `fresh: true` skips the "still downloading"
 * check, for a file we just wrote ourselves.
 */
export async function scanStatements({ fresh = false } = {}): Promise<ScanResult> {
  const folder = statementsDir();
  const result: ScanResult = { scannedAt: new Date().toISOString(), folder, imported: [], skipped: 0, unrecognized: [] };
  if (scanning) {
    // Files that land mid-scan (a big folder copy) get a second pass once this one finishes
    rescanWanted = true;
    return lastScan ?? result;
  }
  scanning = true;
  try {
    mkdirSync(folder, { recursive: true });
    const known = new Set(db.select({ h: importBatches.fileHash }).from(importBatches).all().map((r) => r.h));
    const files = listStatementFiles(folder).sort((a, b) => Number(isPdfPath(a)) - Number(isPdfPath(b)) || a.localeCompare(b));
    for (const path of files) {
      // A file still being written by the browser: catch it on the next scan
      if (!fresh && Date.now() - statSync(path).mtimeMs < 1500) continue;
      const bytes = readFileSync(path);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (known.has(hash)) {
        result.skipped++;
        continue;
      }
      const rel = relative(folder, path);
      try {
        const done = isPdfPath(path)
          ? await importPdf(new Uint8Array(bytes), basename(path), rel, hash)
          : [importCsv(bytes.toString("utf8"), basename(path), rel)];
        known.add(hash);
        if (organizing() && isLoose(rel)) fileAway(folder, path, done);
        result.imported.push(...done);
      } catch (err) {
        const known =
          err instanceof UnrecognizedFormatError ||
          err instanceof UnrecognizedPdfError ||
          err instanceof StatementCheckError ||
          err instanceof AccountUnclearError;
        result.unrecognized.push({
          file: rel,
          error: err instanceof StatementCheckError
            ? `Statement didn't add up, nothing imported: ${err.message}`
            : known ? (err as Error).message : `Import failed: ${(err as Error).message}`,
        });
      }
    }
    for (const r of result.imported) {
      const extra = [r.covered ? `${r.covered} skipped (CSV has those days)` : "", r.replaced ? `${r.replaced} PDF rows replaced` : ""].filter(Boolean).join(", ");
      console.log(`${new Date().toISOString()} Imported ${r.fileName}: ${r.inserted} new, ${r.duplicates} already had${extra ? `, ${extra}` : ""} (${r.accountName})`);
    }
    // PDFs from banks without a reader yet are listed in the app, not logged on every scan
    for (const u of result.unrecognized) {
      if (!u.error.startsWith("Not a statement")) console.log(`${new Date().toISOString()} Not imported ${u.file}: ${u.error}`);
    }
  } finally {
    scanning = false;
  }
  lastScan = result;
  if (rescanWanted) {
    rescanWanted = false;
    setTimeout(() => {
      scanStatements().catch((err) => console.error(`${new Date().toISOString()} Statements scan failed: ${(err as Error).message}`));
    }, 2000);
  }
  return result;
}

const organizing = () => process.env.STATEMENTS_ORGANIZE !== "0";

/** Dropped at the top of the folder, or uploaded from the app: not filed anywhere yet */
function isLoose(rel: string): boolean {
  const parts = rel.split(sep);
  return parts.length === 1 || (parts.length === 2 && parts[0] === "uploads");
}

const cleanName = (s: string) => s.replace(/··/g, "").replace(/[^\w .()-]/g, "").replace(/\s+/g, " ").trim();

/**
 * Move an imported file to <bank>/<year>/<first day> to <last day> <account>.<ext> and point
 * its import batches at the new path. Leaves the file where it is if anything goes wrong.
 */
function fileAway(folder: string, path: string, results: ImportResult[]) {
  const froms = results.map((r) => r.dateFrom).filter((d): d is string => !!d).sort();
  const tos = results.map((r) => r.dateTo).filter((d): d is string => !!d).sort();
  if (!froms.length || !tos.length) return;
  const account = db.select().from(statementAccounts).where(eq(statementAccounts.id, results[0].accountId)).get();
  if (!account) return;
  const from = froms[0];
  const to = tos[tos.length - 1];
  const label = results.length > 1 ? `${account.institution} statement` : results[0].accountName;
  const ext = extname(path).toLowerCase();
  const dir = join(folder, cleanName(account.institution).toLowerCase(), to.slice(0, 4));
  const stem = cleanName(`${from} to ${to} ${label}`);
  let target = join(dir, stem + ext);
  for (let n = 2; existsSync(target); n++) target = join(dir, `${stem} (${n})${ext}`);
  try {
    mkdirSync(dirname(target), { recursive: true });
    renameSync(path, target);
  } catch (err) {
    console.error(`${new Date().toISOString()} Couldn't file ${relative(folder, path)}: ${(err as Error).message}`);
    return;
  }
  const oldName = basename(path);
  const newName = basename(target);
  const rel = relative(folder, target);
  db.transaction((tx) => {
    for (const r of results) {
      r.fileName = r.fileName.replace(oldName, newName);
      tx.update(importBatches).set({ fileName: r.fileName, sourcePath: rel }).where(eq(importBatches.id, r.batchId)).run();
    }
  });
  console.log(`${new Date().toISOString()} Filed ${oldName} as ${rel}`);
}

/** Save an uploaded statement (CSV text, or a PDF as base64) into uploads/ and import it */
export async function saveUpload(fileName: string, content: string, encoding: "utf8" | "base64" = "utf8"): Promise<ScanResult> {
  const dir = join(statementsDir(), "uploads");
  mkdirSync(dir, { recursive: true });
  const safe = basename(fileName).replace(/[^\w .()-]/g, "_") || "upload.csv";
  const ext = /\.(csv|pdf)$/i.test(safe) ? "" : encoding === "base64" ? ".pdf" : ".csv";
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  writeFileSync(join(dir, `${stamp} ${safe}${ext}`), encoding === "base64" ? Buffer.from(content, "base64") : content);
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
    scanStatements().catch((err) => {
      console.error(`${new Date().toISOString()} Statements scan failed: ${(err as Error).message}`);
    });
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
