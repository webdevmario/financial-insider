import { Router } from "express";
import { db } from "../db/index.js";
import { subscriptions } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { today as todayStr } from "../lib/date.js";
import { cleanState } from "../lib/bills.js";
import { computeBillProjections } from "../lib/statements/projection.js";

const cleanAmountMode = (v: unknown) => (v === "listed" ? "listed" : null);

const router = Router();

// GET /api/subscriptions
router.get("/", (_req, res) => {
  const rows = db.select().from(subscriptions).all();
  const projections = computeBillProjections();
  // Parse priceHistory JSON for each row, and attach what history says it will cost
  const parsed = rows.map((r) => ({
    ...r,
    priceHistory: r.priceHistory ? JSON.parse(r.priceHistory) : [],
    projection: projections.get(r.id) ?? null,
  }));
  res.json(parsed);
});

// GET /api/subscriptions/:id
router.get("/:id", (req, res) => {
  const row = db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, req.params.id))
    .get();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({
    ...row,
    priceHistory: row.priceHistory ? JSON.parse(row.priceHistory) : [],
    projection: computeBillProjections().get(row.id) ?? null,
  });
});

// POST /api/subscriptions
router.post("/", (req, res) => {
  const id =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const today = todayStr();
  const body = req.body;

  const row = {
    id,
    name: body.name,
    category: body.category || "Other",
    frequency: body.frequency || "monthly",
    amount: body.amount || 0,
    nextCharge: body.nextCharge || null,
    splitBy: body.splitBy || 1,
    status: body.status || null,
    state: cleanState(body.state),
    stateSince: cleanState(body.state) ? body.stateSince || today : null,
    notes: body.notes || null,
    amountMode: cleanAmountMode(body.amountMode),
    priceHistory: JSON.stringify([{ date: today, amount: body.amount || 0 }]),
    createdAt: today,
  };

  db.insert(subscriptions).values(row).run();
  res.status(201).json({
    ...row,
    priceHistory: JSON.parse(row.priceHistory),
  });
});

// PUT /api/subscriptions/:id
router.put("/:id", (req, res) => {
  const existing = db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, req.params.id))
    .get();
  if (!existing) return res.status(404).json({ error: "Not found" });

  const today = todayStr();
  const body = req.body;

  // Track price changes in history
  let priceHistory = existing.priceHistory
    ? JSON.parse(existing.priceHistory)
    : [];
  if (body.amount != null && body.amount !== existing.amount) {
    priceHistory.push({ date: today, amount: body.amount });
  }

  // Pausing or cancelling records when; going back to active clears it
  const state = body.state !== undefined ? cleanState(body.state) : existing.state;
  const stateSince = !state
    ? null
    : body.stateSince
      ? String(body.stateSince)
      : state !== existing.state || !existing.stateSince
        ? today
        : existing.stateSince;

  db.update(subscriptions)
    .set({
      name: body.name ?? existing.name,
      category: body.category ?? existing.category,
      frequency: body.frequency ?? existing.frequency,
      amount: body.amount ?? existing.amount,
      nextCharge:
        body.nextCharge !== undefined
          ? body.nextCharge
          : existing.nextCharge,
      splitBy: body.splitBy ?? existing.splitBy,
      status: body.status !== undefined ? body.status : existing.status,
      state,
      stateSince,
      notes: body.notes !== undefined ? body.notes : existing.notes,
      amountMode: body.amountMode !== undefined ? cleanAmountMode(body.amountMode) : existing.amountMode,
      priceHistory: JSON.stringify(priceHistory),
    })
    .where(eq(subscriptions.id, req.params.id))
    .run();

  const updated = db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, req.params.id))
    .get();
  res.json({
    ...updated,
    priceHistory: updated?.priceHistory
      ? JSON.parse(updated.priceHistory)
      : [],
  });
});

// DELETE /api/subscriptions/:id
router.delete("/:id", (req, res) => {
  const existing = db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, req.params.id))
    .get();
  if (!existing) return res.status(404).json({ error: "Not found" });

  db.delete(subscriptions)
    .where(eq(subscriptions.id, req.params.id))
    .run();
  res.json({ success: true });
});

export default router;
