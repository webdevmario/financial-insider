import { Router } from "express";
import { and, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { importBatches, merchantRules, statementAccounts, transactions } from "../db/schema.js";
import { KINDS, type Kind } from "../lib/statements/formats.js";
import {
  forgetBatch, lastScanResult, pairTransfers, reapplyRules, saveUpload, scanStatements,
  statementsDir, undoBatch,
} from "../lib/statements/importer.js";
import { computeInsights } from "../lib/statements/insights.js";

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
};

// GET /api/transactions?month=YYYY-MM&account=&kind=&q=&limit=
router.get("/", (req, res) => {
  const { month, account, kind, q } = req.query as Record<string, string | undefined>;
  const limit = Math.min(Number(req.query.limit) || 500, 5000);
  const where: SQL[] = [];
  if (month) where.push(eq(transactions.month, month));
  if (account) where.push(eq(transactions.accountId, account));
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

// ── Rules ─────────────────────────────────────────────────────────

router.get("/rules", (_req, res) => {
  res.json(db.select().from(merchantRules).orderBy(desc(merchantRules.createdAt)).all());
});

router.post("/rules", (req, res) => {
  const pattern = String(req.body.pattern || "").trim();
  if (pattern.length < 3) return res.status(400).json({ error: "Pattern needs at least 3 characters" });
  const kind = req.body.kind && KINDS.includes(req.body.kind as Kind) ? (req.body.kind as string) : null;
  const rule = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    pattern,
    merchant: String(req.body.merchant || "").trim() || null,
    category: String(req.body.category || "").trim() || null,
    kind,
    createdAt: new Date().toISOString(),
  };
  if (!rule.merchant && !rule.category && !rule.kind) return res.status(400).json({ error: "Set a name, category or type" });
  db.insert(merchantRules).values(rule).run();
  res.status(201).json({ rule, updated: reapplyRules() });
});

router.delete("/rules/:id", (req, res) => {
  db.delete(merchantRules).where(eq(merchantRules.id, req.params.id)).run();
  res.json({ success: true });
});

// ── One transaction ───────────────────────────────────────────────

// PUT /api/transactions/:id { merchant?, category?, kind? }
router.put("/:id", (req, res) => {
  const t = db.select().from(transactions).where(eq(transactions.id, req.params.id)).get();
  if (!t) return res.status(404).json({ error: "Not found" });
  const set: Record<string, unknown> = { edited: 1 };
  if (typeof req.body.merchant === "string" && req.body.merchant.trim()) set.merchant = req.body.merchant.trim();
  if (typeof req.body.category === "string" && req.body.category.trim()) set.category = req.body.category.trim();
  if (req.body.kind && KINDS.includes(req.body.kind as Kind) && req.body.kind !== t.kind) {
    set.kind = req.body.kind;
    if (t.transferPeerId && req.body.kind !== "transfer") {
      set.transferPeerId = null;
      db.update(transactions).set({ transferPeerId: null }).where(eq(transactions.id, t.transferPeerId)).run();
    }
  }
  db.update(transactions).set(set).where(eq(transactions.id, t.id)).run();
  pairTransfers();
  const { raw: _raw, ...updated } = db.select().from(transactions).where(eq(transactions.id, t.id)).get()!;
  res.json(updated);
});

export default router;
