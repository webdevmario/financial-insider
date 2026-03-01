import { Router } from "express";
import { db } from "../db/index.js";
import { settings, accounts, subscriptions, expenses } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

// ── Settings key-value store ─────────────────────────────────────

// GET /api/settings/:key
router.get("/settings/:key", (req, res) => {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, req.params.key))
    .get();
  if (!row) return res.json({ key: req.params.key, value: null });
  res.json({ key: row.key, value: JSON.parse(row.value) });
});

// PUT /api/settings/:key
router.put("/settings/:key", (req, res) => {
  const { value } = req.body;
  const encoded = JSON.stringify(value);

  db.insert(settings)
    .values({ key: req.params.key, value: encoded })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: encoded },
    })
    .run();

  res.json({ key: req.params.key, value });
});

// GET /api/settings — get all settings at once (used on app load)
router.get("/settings", (_req, res) => {
  const rows = db.select().from(settings).all();
  const result: Record<string, any> = {};
  for (const row of rows) {
    result[row.key] = JSON.parse(row.value);
  }
  res.json(result);
});

// ── Dashboard summary ────────────────────────────────────────────

router.get("/dashboard/summary", (_req, res) => {
  const allAccounts = db.select().from(accounts).all();
  const allSubs = db.select().from(subscriptions).all();

  const netWorth = allAccounts.reduce((s, a) => s + (a.balance || 0), 0);

  const monthlyBills = allSubs.reduce((s, sub) => {
    const my = (sub.amount || 0) / (sub.splitBy || 1);
    if (sub.frequency === "monthly") return s + my;
    if (sub.frequency === "quarterly") return s + my / 3;
    if (sub.frequency === "annual") return s + my / 12;
    return s;
  }, 0);

  const settingsRow = db
    .select()
    .from(settings)
    .where(eq(settings.key, "income"))
    .get();
  const income = settingsRow ? JSON.parse(settingsRow.value) : 0;

  res.json({ netWorth, income, monthlyBills });
});

// ── Data import/export ───────────────────────────────────────────

// GET /api/data/export — full JSON backup (same format as old app)
router.get("/data/export", (_req, res) => {
  const allAccounts = db.select().from(accounts).all();
  const allSubs = db.select().from(subscriptions).all();
  const allExpenses = db.select().from(expenses).all();
  const allSettings = db.select().from(settings).all();

  const settingsMap: Record<string, any> = {};
  for (const row of allSettings) {
    settingsMap[row.key] = JSON.parse(row.value);
  }

  const exportData = {
    accounts: allAccounts,
    subscriptions: allSubs.map((s) => ({
      ...s,
      priceHistory: s.priceHistory ? JSON.parse(s.priceHistory) : [],
    })),
    expenses: allExpenses.map((e) => ({
      ...e,
      desc: e.description, // backward compat with old app
    })),
    income: settingsMap.income || 0,
    paycheck: settingsMap.paycheck || 0,
    paycheckHistory: settingsMap.paycheckHistory || [],
    budgetTargets: settingsMap.budgetTargets || {},
  };

  res.json(exportData);
});

// POST /api/data/import — restore from backup
router.post("/data/import", (req, res) => {
  const data = req.body;
  const today = new Date().toISOString().slice(0, 10);

  try {
    // Clear existing data
    db.delete(accounts).run();
    db.delete(subscriptions).run();
    db.delete(expenses).run();
    db.delete(settings).run();

    // Import accounts
    if (data.accounts?.length) {
      for (const a of data.accounts) {
        db.insert(accounts)
          .values({
            id: a.id,
            type: a.type || "Other",
            balance: a.balance || 0,
            owner: a.owner || null,
            institution: a.institution || null,
            notes: a.notes || null,
            homeValue: a.homeValue ?? null,
            mortgageBalance: a.mortgageBalance ?? null,
            lastUpdated: a.lastUpdated || today,
            createdAt: a.createdAt || today,
          })
          .run();
      }
    }

    // Import subscriptions
    if (data.subscriptions?.length) {
      for (const s of data.subscriptions) {
        db.insert(subscriptions)
          .values({
            id: s.id,
            name: s.name,
            category: s.category || "Other",
            frequency: s.frequency || "monthly",
            amount: s.amount || 0,
            nextCharge: s.nextCharge || null,
            splitBy: s.splitBy || 1,
            status: s.status || null,
            notes: s.notes || null,
            priceHistory: s.priceHistory
              ? JSON.stringify(s.priceHistory)
              : null,
            createdAt: s.createdAt || today,
          })
          .run();
      }
    }

    // Import expenses
    if (data.expenses?.length) {
      for (const e of data.expenses) {
        db.insert(expenses)
          .values({
            id: e.id,
            date: e.date,
            month: e.month || e.date?.slice(0, 7),
            description: e.desc || e.description || "",
            category: e.category || "General",
            amount: e.amount || 0,
          })
          .run();
      }
    }

    // Import settings
    const settingsToImport: [string, any][] = [];
    if (data.paycheck != null)
      settingsToImport.push(["paycheck", data.paycheck]);
    if (data.income != null) settingsToImport.push(["income", data.income]);
    if (data.paycheckHistory)
      settingsToImport.push(["paycheckHistory", data.paycheckHistory]);
    if (data.budgetTargets)
      settingsToImport.push(["budgetTargets", data.budgetTargets]);

    for (const [key, value] of settingsToImport) {
      db.insert(settings)
        .values({ key, value: JSON.stringify(value) })
        .run();
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Import failed:", err);
    res.status(500).json({ error: "Import failed" });
  }
});

export default router;
