import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { payeeAliases, payees, subscriptions, type Payee } from "../db/schema.js";
import { KINDS, type Kind } from "../lib/statements/formats.js";
import { pairTransfers } from "../lib/statements/importer.js";
import {
  addAlias, deletePayee, findOrCreatePayee, listPayees, MATCH_TYPES, mergeInto,
  payeeDetail, previewAlias, recomputeAll, unassignedMerchants, unassignedTransactions,
} from "../lib/statements/payees.js";

const router = Router();

/** After any payee change: re-derive every transaction, then re-pair transfers */
function refresh() {
  recomputeAll();
  pairTransfers();
}

function amountOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? Math.abs(n) : null;
}

function cleanDefaults(body: Record<string, unknown>): Partial<Payee> {
  const out: Partial<Payee> = {};
  if (body.category !== undefined) out.category = String(body.category || "").trim() || null;
  if (body.kind !== undefined) out.kind = body.kind && KINDS.includes(body.kind as Kind) ? String(body.kind) : null;
  if (body.billId !== undefined) {
    const id = body.billId ? String(body.billId) : null;
    out.billId = id && db.select().from(subscriptions).where(eq(subscriptions.id, id)).get() ? id : null;
  }
  if (body.notes !== undefined) out.notes = String(body.notes || "").trim() || null;
  return out;
}

// GET /api/payees
router.get("/", (_req, res) => {
  res.json(listPayees());
});

// GET /api/payees/unassigned — bank names with no payee yet
router.get("/unassigned", (_req, res) => {
  res.json(unassignedMerchants());
});

// GET /api/payees/unassigned/:key/transactions?limit= — the rows behind one bank name, newest first
router.get("/unassigned/:key/transactions", (req, res) => {
  const limit = Math.max(0, Math.floor(Number(req.query.limit) || 0));
  res.json(unassignedTransactions(req.params.key, limit || undefined));
});

// POST /api/payees/preview { pattern, match, amount? } — what an alias would match
router.post("/preview", (req, res) => {
  const pattern = String(req.body.pattern || "").trim();
  if (pattern.length < 3) return res.json({ count: 0, total: 0, merchants: [], samples: [] });
  res.json(previewAlias(pattern, String(req.body.match || "contains"), amountOrNull(req.body.amount)));
});

// POST /api/payees/merge { payeeId?, name?, category?, members: ["p:<id>" | "m:<key>"] }
router.post("/merge", (req, res) => {
  const members = Array.isArray(req.body.members) ? req.body.members.map(String) : [];
  if (!members.length) return res.status(400).json({ error: "Nothing to merge" });
  try {
    const payee = mergeInto({ payeeId: req.body.payeeId, name: req.body.name, category: req.body.category }, members);
    pairTransfers();
    res.json(payeeDetail(payee.id));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST /api/payees { name, category?, kind?, billId? }
router.post("/", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required" });
  const payee = findOrCreatePayee(name);
  const defaults = cleanDefaults(req.body);
  if (Object.keys(defaults).length) db.update(payees).set(defaults).where(eq(payees.id, payee.id)).run();
  refresh();
  res.status(201).json(payeeDetail(payee.id));
});

// GET /api/payees/:id
router.get("/:id", (req, res) => {
  const detail = payeeDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: "Not found" });
  res.json(detail);
});

// PUT /api/payees/:id { name?, category?, kind?, billId?, notes? }
router.put("/:id", (req, res) => {
  const existing = db.select().from(payees).where(eq(payees.id, req.params.id)).get();
  if (!existing) return res.status(404).json({ error: "Not found" });
  const set = cleanDefaults(req.body);
  if (req.body.name !== undefined) {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name is required" });
    const clash = db.select().from(payees).all().find((p) => p.id !== existing.id && p.name.toLowerCase() === name.toLowerCase());
    if (clash) return res.status(409).json({ error: `“${clash.name}” already exists. Merge them instead.` });
    set.name = name;
  }
  db.update(payees).set(set).where(eq(payees.id, existing.id)).run();
  refresh();
  res.json(payeeDetail(existing.id));
});

// DELETE /api/payees/:id — its transactions go back to their bank names
router.delete("/:id", (req, res) => {
  deletePayee(req.params.id);
  pairTransfers();
  res.json({ success: true });
});

// POST /api/payees/:id/aliases { pattern, match?, amount? }
router.post("/:id/aliases", (req, res) => {
  const payee = db.select().from(payees).where(eq(payees.id, req.params.id)).get();
  if (!payee) return res.status(404).json({ error: "Not found" });
  const pattern = String(req.body.pattern || "").trim();
  if (pattern.length < 3) return res.status(400).json({ error: "Alias text needs at least 3 characters" });
  const match = MATCH_TYPES.includes(req.body.match) ? req.body.match : "contains";
  addAlias(payee.id, pattern, match, amountOrNull(req.body.amount));
  refresh();
  res.status(201).json(payeeDetail(payee.id));
});

router.delete("/:id/aliases/:aliasId", (req, res) => {
  db.delete(payeeAliases).where(eq(payeeAliases.id, req.params.aliasId)).run();
  refresh();
  res.json(payeeDetail(req.params.id));
});

export default router;
