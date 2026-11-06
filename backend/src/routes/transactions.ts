import { Router } from "express";
import { and, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { importBatches, payeeAliases, payees, statementAccounts, transactions, type Payee, type Transaction } from "../db/schema.js";
import { KINDS, type Kind } from "../lib/statements/formats.js";
import {
  forgetBatch, lastScanResult, pairTransfers, saveUpload, scanStatements,
  statementsDir, undoBatch,
} from "../lib/statements/importer.js";
import { computeInsights } from "../lib/statements/insights.js";
import { addAlias, findOrCreatePayee, recomputeAll } from "../lib/statements/payees.js";

const router = Router();

/** Everything but the raw CSV row */
const listColumns = {
  id: transactions.id,
  accountId: transactions.accountId,
  date: transactions.date,
  postedDate: transactions.postedDate,
  month: transactions.month,
  amount: transactions.amount,
  description: transactions.description,
  merchant: transactions.merchant,
  category: transactions.category,
  kind: transactions.kind,
  member: transactions.member,
  transferPeerId: transactions.transferPeerId,
  edited: transactions.edited,
  baseMerchant: transactions.baseMerchant,
  payeeId: transactions.payeeId,
  payeeLocked: transactions.payeeLocked,
};

// GET /api/transactions?month=YYYY-MM&account=&kind=&q=&limit=
router.get("/", (req, res) => {
  const { month, account, kind, q } = req.query as Record<string, string | undefined>;
  const limit = Math.min(Number(req.query.limit) || 500, 5000);
  const where: SQL[] = [];
  if (month) where.push(eq(transactions.month, month));
  if (account) where.push(eq(transactions.accountId, account));
  if (req.query.payee) where.push(eq(transactions.payeeId, String(req.query.payee)));
  if (kind) where.push(eq(transactions.kind, kind));
  if (q?.trim()) {
    const pattern = `%${q.trim()}%`;
    where.push(or(like(transactions.description, pattern), like(transactions.merchant, pattern), like(transactions.category, pattern))!);
  }
  const rows = db
    .select(listColumns)
    .from(transactions)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(limit)
    .all();
  res.json(rows);
});

// GET /api/transactions/insights?month=YYYY-MM
router.get("/insights", (req, res) => {
  res.json(computeInsights(req.query.month as string | undefined));
});

// ── Accounts ──────────────────────────────────────────────────────

router.get("/accounts", (_req, res) => {
  const stats = db
    .select({
      accountId: transactions.accountId,
      count: sql<number>`count(*)`,
      first: sql<string>`min(${transactions.date})`,
      last: sql<string>`max(${transactions.date})`,
    })
    .from(transactions)
    .groupBy(transactions.accountId)
    .all();
  const byId = new Map(stats.map((s) => [s.accountId, s]));
  res.json(
    db.select().from(statementAccounts).all().map((a) => ({
      ...a,
      count: byId.get(a.id)?.count ?? 0,
      firstDate: byId.get(a.id)?.first ?? null,
      lastDate: byId.get(a.id)?.last ?? null,
    }))
  );
});

router.put("/accounts/:id", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required" });
  const r = db.update(statementAccounts).set({ name }).where(eq(statementAccounts.id, req.params.id)).run();
  if (!r.changes) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

// ── Imports and the statements folder ─────────────────────────────

router.get("/imports", (_req, res) => {
  res.json({
    folder: statementsDir(),
    lastScan: lastScanResult(),
    batches: db.select().from(importBatches).orderBy(desc(importBatches.importedAt)).limit(100).all(),
  });
});

router.post("/scan", (_req, res) => {
  try {
    res.json(scanStatements());
  } catch (err) {
    res.status(500).json({ error: `Scan failed: ${(err as Error).message}` });
  }
});

// POST /api/transactions/upload { name, content } — content is the CSV text
router.post("/upload", (req, res) => {
  const { name, content } = req.body as { name?: string; content?: string };
  if (!content?.trim()) return res.status(400).json({ error: "File is empty" });
  try {
    res.json(saveUpload(name || "upload.csv", content));
  } catch (err) {
    res.status(500).json({ error: `Upload failed: ${(err as Error).message}` });
  }
});

router.post("/imports/:id/undo", (req, res) => {
  const batch = db.select().from(importBatches).where(eq(importBatches.id, req.params.id)).get();
  if (!batch) return res.status(404).json({ error: "Not found" });
  res.json({ removed: undoBatch(batch.id) });
});

// Forget an undone import so the next scan picks the file up again
router.post("/imports/:id/forget", (req, res) => {
  forgetBatch(req.params.id);
  res.json(scanStatements({ fresh: true }));
});

// ── One transaction ───────────────────────────────────────────────

// PUT /api/transactions/:id
// { payeeId?: string | null, payeeName?: string, category?, kind?,
//   remember?: { pattern, match, amount? },  // add an alias + make category/kind the payee's defaults
//   reset?: true }                             // drop hand edits and go back to automatic
router.put("/:id", (req, res) => {
  const t = db.select().from(transactions).where(eq(transactions.id, req.params.id)).get();
  if (!t) return res.status(404).json({ error: "Not found" });
  const body = req.body as {
    payeeId?: string | null;
    payeeName?: string;
    category?: string;
    kind?: string;
    remember?: { pattern?: string; match?: string; amount?: number | null };
    reset?: boolean;
  };

  if (body.reset) {
    db.update(transactions).set({ edited: 0, payeeLocked: 0 }).where(eq(transactions.id, t.id)).run();
  } else {
    let payee: Payee | undefined;
    if (body.payeeName?.trim()) payee = findOrCreatePayee(body.payeeName);
    else if (body.payeeId) payee = db.select().from(payees).where(eq(payees.id, body.payeeId)).get();
    const category = body.category?.trim() || undefined;
    const kind = body.kind && KINDS.includes(body.kind as Kind) ? body.kind : undefined;

    if (body.remember) {
      const pattern = body.remember.pattern?.trim() || "";
      if (!payee) return res.status(400).json({ error: "Choose a payee to remember this for" });
      if (pattern.length < 3) return res.status(400).json({ error: "Alias text needs at least 3 characters" });
      addAlias(payee.id, pattern, body.remember.match, body.remember.amount ?? null);
      const defaults: Partial<Payee> = {};
      if (category && category !== payee.category) defaults.category = category;
      if (kind && kind !== payee.kind) defaults.kind = kind;
      if (Object.keys(defaults).length) db.update(payees).set(defaults).where(eq(payees.id, payee.id)).run();
      // The alias and payee defaults now decide this row too
      db.update(transactions).set({ edited: 0, payeeLocked: 0 }).where(eq(transactions.id, t.id)).run();
    } else {
      const set: Partial<Transaction> = {};
      if (payee) Object.assign(set, { payeeId: payee.id, payeeLocked: 1 });
      else if (body.payeeId === null) Object.assign(set, { payeeId: null, payeeLocked: 0 });
      if ((category && category !== t.category) || (kind && kind !== t.kind)) {
        Object.assign(set, { edited: 1, category: category ?? t.category, kind: kind ?? t.kind });
        if (kind && kind !== "transfer" && t.transferPeerId) {
          set.transferPeerId = null;
          db.update(transactions).set({ transferPeerId: null }).where(eq(transactions.id, t.transferPeerId)).run();
        }
      }
      if (Object.keys(set).length) db.update(transactions).set(set).where(eq(transactions.id, t.id)).run();
    }
  }

  recomputeAll();
  pairTransfers();
  // A payee picked for one transaction and then dropped leaves nothing behind
  const inUse = new Set(
    db.select({ id: transactions.payeeId }).from(transactions).all().map((r) => r.id)
      .concat(db.select({ id: payeeAliases.payeeId }).from(payeeAliases).all().map((r) => r.id))
  );
  for (const p of db.select().from(payees).all()) {
    if (!inUse.has(p.id) && !p.billId) db.delete(payees).where(eq(payees.id, p.id)).run();
  }
  const { raw: _raw, ...updated } = db.select().from(transactions).where(eq(transactions.id, t.id)).get()!;
  res.json(updated);
});

export default router;
