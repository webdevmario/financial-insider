import { Router } from "express";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

// GET /api/accounts — list all accounts
router.get("/", (_req, res) => {
  const rows = db.select().from(accounts).all();
  res.json(rows);
});

// GET /api/accounts/:id — single account
router.get("/:id", (req, res) => {
  const row = db
    .select()
    .from(accounts)
    .where(eq(accounts.id, req.params.id))
    .get();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// POST /api/accounts — create account
router.post("/", (req, res) => {
  const id =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const today = new Date().toISOString().slice(0, 10);
  const body = req.body;

  const row = {
    id,
    type: body.type || "Other",
    balance: body.balance ?? 0,
    owner: body.owner || null,
    institution: body.institution || null,
    notes: body.notes || null,
    homeValue: body.homeValue ?? null,
    mortgageBalance: body.mortgageBalance ?? null,
    lastUpdated: today,
    createdAt: today,
  };

  db.insert(accounts).values(row).run();
  res.status(201).json(row);
});

// PUT /api/accounts/:id — update account
router.put("/:id", (req, res) => {
  const existing = db
    .select()
    .from(accounts)
    .where(eq(accounts.id, req.params.id))
    .get();
  if (!existing) return res.status(404).json({ error: "Not found" });

  const today = new Date().toISOString().slice(0, 10);
  const body = req.body;

  db.update(accounts)
    .set({
      type: body.type ?? existing.type,
      balance: body.balance ?? existing.balance,
      owner: body.owner !== undefined ? body.owner : existing.owner,
      institution:
        body.institution !== undefined
          ? body.institution
          : existing.institution,
      notes: body.notes !== undefined ? body.notes : existing.notes,
      homeValue:
        body.homeValue !== undefined ? body.homeValue : existing.homeValue,
      mortgageBalance:
        body.mortgageBalance !== undefined
          ? body.mortgageBalance
          : existing.mortgageBalance,
      lastUpdated: today,
    })
    .where(eq(accounts.id, req.params.id))
    .run();

  const updated = db
    .select()
    .from(accounts)
    .where(eq(accounts.id, req.params.id))
    .get();
  res.json(updated);
});

// DELETE /api/accounts/:id
router.delete("/:id", (req, res) => {
  const existing = db
    .select()
    .from(accounts)
    .where(eq(accounts.id, req.params.id))
    .get();
  if (!existing) return res.status(404).json({ error: "Not found" });

  db.delete(accounts).where(eq(accounts.id, req.params.id)).run();
  res.json({ success: true });
});

export default router;
