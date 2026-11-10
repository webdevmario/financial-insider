import { Router } from "express";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { creditCards, statementAccounts, type CreditCard } from "../db/schema.js";
import { today as todayStr } from "../lib/date.js";
import { cardAnalysis, parseRates, spendingCategories, type RewardRates } from "../lib/statements/card-rewards.js";

const router: Router = Router();

const UNITS = ["percent", "points"];

function parse(row: CreditCard) {
  return { ...row, inUse: !!row.inUse, rewardRates: parseRates(row.rewardRates), rewardCaps: parseRates(row.rewardCaps) };
}

function find(id: string) {
  return db.select().from(creditCards).where(eq(creditCards.id, id)).get();
}

function num(n: unknown, fallback: number | null): number | null {
  if (n === null || n === "") return fallback;
  const v = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 10000) / 10000 : fallback;
}

/** Keep only { category: non-negative number } pairs; "*" means every other category */
function cleanRates(input: unknown): RewardRates {
  const out: RewardRates = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const key = k.trim();
    const rate = num(v, null);
    if (key && rate !== null) out[key] = rate;
  }
  return out;
}

function date(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** A link must name a real statement account that no other card already uses */
function checkAccount(accountId: string | null, cardId?: string): string | null {
  if (!accountId) return null;
  if (!db.select().from(statementAccounts).where(eq(statementAccounts.id, accountId)).get()) {
    return "That statement account doesn't exist";
  }
  const other = db
    .select()
    .from(creditCards)
    .where(cardId ? and(eq(creditCards.statementAccountId, accountId), ne(creditCards.id, cardId)) : eq(creditCards.statementAccountId, accountId))
    .get();
  return other ? `That account is already linked to ${other.name}` : null;
}

// GET /api/cards
router.get("/", (_req, res) => {
  res.json(db.select().from(creditCards).all().map(parse));
});

// GET /api/cards/analysis?months=12 — spending and rewards per linked card, and the best stored card per category
router.get("/analysis", (req, res) => {
  const months = Math.min(36, Math.max(1, parseInt(String(req.query.months ?? "12"), 10) || 12));
  res.json({ ...cardAnalysis(months), categories: spendingCategories() });
});

// POST /api/cards
router.post("/", (req, res) => {
  const body = req.body;
  if (!body.name?.trim()) return res.status(400).json({ error: "Name is required" });
  const accountId = body.statementAccountId || null;
  const bad = checkAccount(accountId);
  if (bad) return res.status(400).json({ error: bad });

  const row = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: body.name.trim(),
    issuer: body.issuer?.trim() || null,
    statementAccountId: accountId,
    annualFee: num(body.annualFee, 0)!,
    rewardUnit: UNITS.includes(body.rewardUnit) ? body.rewardUnit : "percent",
    pointValue: num(body.pointValue, null),
    rewardRates: JSON.stringify(cleanRates(body.rewardRates)),
    rewardCaps: JSON.stringify(cleanRates(body.rewardCaps)),
    benefits: body.benefits?.trim() || null,
    lastReviewed: date(body.lastReviewed),
    inUse: body.inUse === false ? 0 : 1,
    createdAt: todayStr(),
  };
  db.insert(creditCards).values(row).run();
  res.status(201).json(parse(row));
});

// PUT /api/cards/:id — fields left out keep their values
router.put("/:id", (req, res) => {
  const existing = find(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });
  const body = req.body;

  const accountId = body.statementAccountId !== undefined ? body.statementAccountId || null : existing.statementAccountId;
  const bad = accountId !== existing.statementAccountId ? checkAccount(accountId, existing.id) : null;
  if (bad) return res.status(400).json({ error: bad });

  db.update(creditCards)
    .set({
      name: body.name?.trim() || existing.name,
      issuer: body.issuer !== undefined ? body.issuer?.trim() || null : existing.issuer,
      statementAccountId: accountId,
      annualFee: body.annualFee !== undefined ? num(body.annualFee, 0)! : existing.annualFee,
      rewardUnit: UNITS.includes(body.rewardUnit) ? body.rewardUnit : existing.rewardUnit,
      pointValue: body.pointValue !== undefined ? num(body.pointValue, null) : existing.pointValue,
      rewardRates: body.rewardRates !== undefined ? JSON.stringify(cleanRates(body.rewardRates)) : existing.rewardRates,
      rewardCaps: body.rewardCaps !== undefined ? JSON.stringify(cleanRates(body.rewardCaps)) : existing.rewardCaps,
      benefits: body.benefits !== undefined ? body.benefits?.trim() || null : existing.benefits,
      lastReviewed: body.lastReviewed !== undefined ? date(body.lastReviewed) : existing.lastReviewed,
      inUse: body.inUse !== undefined ? (body.inUse ? 1 : 0) : existing.inUse,
    })
    .where(eq(creditCards.id, existing.id))
    .run();

  res.json(parse(find(existing.id)!));
});

// DELETE /api/cards/:id
router.delete("/:id", (req, res) => {
  const existing = find(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });
  db.delete(creditCards).where(eq(creditCards.id, existing.id)).run();
  res.json({ success: true });
});

export default router;
