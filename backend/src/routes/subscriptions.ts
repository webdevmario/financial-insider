import { Router } from "express";
import { db } from "../db/index.js";
import { subscriptions } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

// GET /api/subscriptions
router.get("/", (_req, res) => {
  const rows = db.select().from(subscriptions).all();
  // Parse priceHistory JSON for each row
  const parsed = rows.map((r) => ({
    ...r,
    priceHistory: r.priceHistory ? JSON.parse(r.priceHistory) : [],
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
  });
});

// POST /api/subscriptions
router.post("/", (req, res) => {
  const id =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const today = new Date().toISOString().slice(0, 10);
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
    notes: body.notes || null,
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

  const today = new Date().toISOString().slice(0, 10);
  const body = req.body;

  // Track price changes in history
  let priceHistory = existing.priceHistory
    ? JSON.parse(existing.priceHistory)
    : [];
  if (body.amount != null && body.amount !== existing.amount) {
    priceHistory.push({ date: today, amount: body.amount });
  }

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
      notes: body.notes !== undefined ? body.notes : existing.notes,
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
