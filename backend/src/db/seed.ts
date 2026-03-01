/**
 * Seed script: imports data from the old app's JSON export.
 *
 * Usage:
 *   1. In the old app, go to Settings → Export (JSON backup)
 *   2. Save the file as data/export.json
 *   3. Run: pnpm seed
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "./index.js";
import { accounts, subscriptions, expenses, settings } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const exportPath = resolve(__dirname, "../../../data/export.json");

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function seed() {
  if (!existsSync(exportPath)) {
    console.error("❌ No export file found at data/export.json");
    console.error("   Export your data from the old app (Settings → Export JSON)");
    console.error("   and save it as data/export.json");
    process.exit(1);
  }

  const raw = readFileSync(exportPath, "utf-8");
  const data = JSON.parse(raw);
  const today = new Date().toISOString().slice(0, 10);

  console.log("🔄 Importing data...\n");

  // ── Accounts ───────────────────────────────────────────────────
  if (data.accounts?.length) {
    const rows = data.accounts.map((a: any) => ({
      id: a.id || generateId(),
      type: a.type || "Other",
      balance: a.balance || 0,
      owner: a.owner || null,
      institution: a.institution || null,
      notes: a.notes || null,
      homeValue: a.homeValue ?? null,
      mortgageBalance: a.mortgageBalance ?? null,
      lastUpdated: a.lastUpdated || today,
      createdAt: a.lastUpdated || today,
    }));

    for (const row of rows) {
      db.insert(accounts).values(row).onConflictDoNothing().run();
    }
    console.log(`  ✅ ${rows.length} accounts imported`);
  }

  // ── Subscriptions ──────────────────────────────────────────────
  if (data.subscriptions?.length) {
    const rows = data.subscriptions.map((s: any) => ({
      id: s.id || generateId(),
      name: s.name,
      category: s.category || "Other",
      frequency: s.frequency || "monthly",
      amount: s.amount || 0,
      nextCharge: s.nextCharge || null,
      splitBy: s.splitBy || 1,
      status: s.status || null,
      notes: s.notes || null,
      priceHistory: s.priceHistory ? JSON.stringify(s.priceHistory) : null,
      createdAt: today,
    }));

    for (const row of rows) {
      db.insert(subscriptions).values(row).onConflictDoNothing().run();
    }
    console.log(`  ✅ ${rows.length} subscriptions imported`);
  }

  // ── Expenses ───────────────────────────────────────────────────
  if (data.expenses?.length) {
    const rows = data.expenses.map((e: any) => ({
      id: e.id || generateId(),
      date: e.date,
      month: e.month || e.date?.slice(0, 7),
      description: e.desc || e.description || "",
      category: e.category || "General",
      amount: e.amount || 0,
    }));

    for (const row of rows) {
      db.insert(expenses).values(row).onConflictDoNothing().run();
    }
    console.log(`  ✅ ${rows.length} expenses imported`);
  }

  // ── Settings ───────────────────────────────────────────────────
  if (data.paycheck != null) {
    db.insert(settings)
      .values({ key: "paycheck", value: JSON.stringify(data.paycheck) })
      .onConflictDoNothing()
      .run();
  }

  if (data.income != null) {
    db.insert(settings)
      .values({ key: "income", value: JSON.stringify(data.income) })
      .onConflictDoNothing()
      .run();
  }

  if (data.paycheckHistory?.length) {
    db.insert(settings)
      .values({
        key: "paycheckHistory",
        value: JSON.stringify(data.paycheckHistory),
      })
      .onConflictDoNothing()
      .run();
  }

  if (data.budgetTargets && Object.keys(data.budgetTargets).length) {
    db.insert(settings)
      .values({
        key: "budgetTargets",
        value: JSON.stringify(data.budgetTargets),
      })
      .onConflictDoNothing()
      .run();
  }

  console.log(`  ✅ Settings imported`);
  console.log("\n🎉 Import complete!");
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
