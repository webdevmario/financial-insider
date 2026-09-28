import { Router } from "express";
import { db } from "../db/index.js";
import { expenses } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { today } from "../lib/date.js";

const router = Router();

// GET /api/expenses?month=2026-03 — list expenses, optionally filtered by month
router.get("/", (req, res) => {
  const month = req.query.month as string | undefined;

  if (month) {
    const rows = db
      .select()
      .from(expenses)
      .where(eq(expenses.month, month))
      .orderBy(desc(expenses.date))
      .all();
    return res.json(rows);
  }

  const rows = db.select().from(expenses).orderBy(desc(expenses.date)).all();
  res.json(rows);
});

// GET /api/expenses/months — list all months that have expenses (for the dropdown)
router.get("/months", (_req, res) => {
  const rows = db
    .selectDistinct({ month: expenses.month })
    .from(expenses)
    .orderBy(desc(expenses.month))
    .all();
  res.json(rows.map((r) => r.month));
});

// POST /api/expenses — create expense
router.post("/", (req, res) => {
  const id =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const body = req.body;

  // Default to today if no date provided
  const date =
    body.date ||
    today();
  const month = body.month || date.slice(0, 7);

  const row = {
    id,
    date,
    month,
    description: body.description || "",
    category: body.category || "General",
    amount: body.amount || 0,
  };

  db.insert(expenses).values(row).run();
  res.status(201).json(row);
});

// PUT /api/expenses/:id — update expense in place
router.put("/:id", (req, res) => {
  const existing = db
    .select()
    .from(expenses)
    .where(eq(expenses.id, req.params.id))
    .get();
  if (!existing) return res.status(404).json({ error: "Not found" });

  const body = req.body;
  const date = body.date || existing.date;

  db.update(expenses)
    .set({
      date,
      month: body.month || date.slice(0, 7),
      description: body.description ?? existing.description,
      category: body.category ?? existing.category,
      amount: body.amount ?? existing.amount,
    })
    .where(eq(expenses.id, req.params.id))
    .run();

  const updated = db
    .select()
    .from(expenses)
    .where(eq(expenses.id, req.params.id))
    .get();
  res.json(updated);
});

// DELETE /api/expenses/:id
router.delete("/:id", (req, res) => {
  const existing = db
    .select()
    .from(expenses)
    .where(eq(expenses.id, req.params.id))
    .get();
  if (!existing) return res.status(404).json({ error: "Not found" });

  db.delete(expenses).where(eq(expenses.id, req.params.id)).run();
  res.json({ success: true });
});

export default router;
