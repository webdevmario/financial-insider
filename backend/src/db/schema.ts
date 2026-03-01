import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

// ── Accounts (Assets) ──────────────────────────────────────────────
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // Checking, Savings, 401k, Roth IRA, Home Equity, Vehicle, etc.
  balance: real("balance").notNull().default(0),
  owner: text("owner"), // Mario, Vivian, Joint, or null
  institution: text("institution"), // Fidelity, Ally, etc.
  notes: text("notes"),
  homeValue: real("home_value"), // Only for Home Equity type
  mortgageBalance: real("mortgage_balance"), // Only for Home Equity type
  lastUpdated: text("last_updated"),
  createdAt: text("created_at").notNull(),
});

// ── Subscriptions (Bills) ──────────────────────────────────────────
export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull().default("Other"),
  frequency: text("frequency").notNull().default("monthly"), // monthly | quarterly | annual
  amount: real("amount").notNull().default(0),
  nextCharge: text("next_charge"),
  splitBy: integer("split_by").notNull().default(1),
  status: text("status"), // essential | review | null
  notes: text("notes"),
  priceHistory: text("price_history"), // JSON string: [{date, amount}]
  createdAt: text("created_at").notNull(),
});

// ── Expenses (Budget tracking) ─────────────────────────────────────
export const expenses = sqliteTable("expenses", {
  id: text("id").primaryKey(),
  date: text("date").notNull(), // YYYY-MM-DD
  month: text("month").notNull(), // YYYY-MM (indexed for fast filtering)
  description: text("description").notNull(),
  category: text("category").notNull().default("General"),
  amount: real("amount").notNull(),
});

// ── Settings (key-value store) ─────────────────────────────────────
// Stores: paycheck, income, paycheckHistory, budgetTargets
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON-encoded
});

// ── Type exports for use in routes ─────────────────────────────────
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
