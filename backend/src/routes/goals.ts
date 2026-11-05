import { Router } from "express";
import { db } from "../db/index.js";
import { goals, type Goal } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { today as todayStr } from "../lib/date.js";

const router = Router();

const PRIORITIES = ["high", "medium", "low"];

type HistoryEntry = { date: string; amount: number; note?: string };

function parse(row: Goal) {
  return {
    ...row,
    history: (row.history ? JSON.parse(row.history) : []) as HistoryEntry[],
  };
}

function find(id: string) {
  return db.select().from(goals).where(eq(goals.id, id)).get();
}

function money(n: unknown): number {
  const v = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

/** Set completedAt the first time a goal reaches its target; clear it if it drops back below */
function completedAt(saved: number, target: number, prev: string | null): string | null {
  if (target > 0 && saved >= target) return prev || todayStr();
  return null;
}

// GET /api/goals
router.get("/", (_req, res) => {
  res.json(db.select().from(goals).all().map(parse));
});

// GET /api/goals/:id
router.get("/:id", (req, res) => {
  const row = find(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(parse(row));
});

// POST /api/goals
router.post("/", (req, res) => {
  const body = req.body;
  if (!body.name?.trim()) return res.status(400).json({ error: "Name is required" });

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const today = todayStr();
  const target = money(body.targetAmount);
  const saved = money(body.savedAmount);

  const row = {
    id,
    name: body.name.trim(),
    targetAmount: target,
    savedAmount: saved,
    deadline: body.deadline || null,
    priority: PRIORITIES.includes(body.priority) ? body.priority : "medium",
    notes: body.notes || null,
    history: JSON.stringify(saved ? [{ date: today, amount: saved, note: "Starting balance" }] : []),
    completedAt: completedAt(saved, target, null),
    createdAt: today,
  };

  db.insert(goals).values(row).run();
  res.status(201).json(parse(row));
});

// PUT /api/goals/:id — edit details. A changed savedAmount is logged as an adjustment.
router.put("/:id", (req, res) => {
  const existing = find(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });

  const body = req.body;
  const history: HistoryEntry[] = existing.history ? JSON.parse(existing.history) : [];
  const target = body.targetAmount != null ? money(body.targetAmount) : existing.targetAmount;
  let saved = existing.savedAmount;
  if (body.savedAmount != null) {
    const next = money(body.savedAmount);
    const delta = money(next - existing.savedAmount);
    if (delta !== 0) history.push({ date: todayStr(), amount: delta, note: "Adjusted" });
    saved = next;
  }

  db.update(goals)
    .set({
      name: body.name?.trim() || existing.name,
      targetAmount: target,
      savedAmount: saved,
      deadline: body.deadline !== undefined ? body.deadline || null : existing.deadline,
      priority: PRIORITIES.includes(body.priority) ? body.priority : existing.priority,
      notes: body.notes !== undefined ? body.notes || null : existing.notes,
      history: JSON.stringify(history),
      completedAt: completedAt(saved, target, existing.completedAt),
    })
    .where(eq(goals.id, existing.id))
    .run();

  res.json(parse(find(existing.id)!));
});

// POST /api/goals/:id/contributions — add (or withdraw, with a negative amount) money
router.post("/:id/contributions", (req, res) => {
  const existing = find(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });

  const amount = money(req.body.amount);
  if (amount === 0) return res.status(400).json({ error: "Amount is required" });

  const history: HistoryEntry[] = existing.history ? JSON.parse(existing.history) : [];
  const entry: HistoryEntry = { date: req.body.date || todayStr(), amount };
  if (req.body.note?.trim()) entry.note = req.body.note.trim();
  history.push(entry);
  history.sort((a, b) => a.date.localeCompare(b.date));

  const saved = money(existing.savedAmount + amount);
  db.update(goals)
    .set({
      savedAmount: saved,
      history: JSON.stringify(history),
      completedAt: completedAt(saved, existing.targetAmount, existing.completedAt),
    })
    .where(eq(goals.id, existing.id))
    .run();

  res.status(201).json(parse(find(existing.id)!));
});

// DELETE /api/goals/:id
router.delete("/:id", (req, res) => {
  const existing = find(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });
  db.delete(goals).where(eq(goals.id, existing.id)).run();
  res.json({ success: true });
});

export default router;
