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
  /** Whether the bill is still being paid: null (active) | paused | cancelled */
  state: text("state"),
  /** When it was paused or cancelled (YYYY-MM-DD) */
  stateSince: text("state_since"),
  /** "listed" pins totals to the typed amount; null projects it from real charges */
  amountMode: text("amount_mode"),
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
  updatedAt: text("updated_at"), // ISO timestamp of the last edit, for last-write-wins sync
});

// ── Goals (Savings targets) ────────────────────────────────────────
export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  targetAmount: real("target_amount").notNull().default(0),
  savedAmount: real("saved_amount").notNull().default(0),
  deadline: text("deadline"), // YYYY-MM-DD, optional
  priority: text("priority").notNull().default("medium"), // high | medium | low
  notes: text("notes"),
  history: text("history"), // JSON string: [{date, amount, note?}] — each entry is a change to savedAmount
  completedAt: text("completed_at"), // YYYY-MM-DD the goal first reached its target
  createdAt: text("created_at").notNull(),
});

// ── Statement accounts (where imported transactions come from) ─────
// One per bank account or card seen in an imported CSV, keyed like "chase-0134"
export const statementAccounts = sqliteTable("statement_accounts", {
  id: text("id").primaryKey(),
  institution: text("institution").notNull(), // Chase, Amex, Apple, Ally
  name: text("name").notNull(), // Display name, editable
  kind: text("kind").notNull(), // checking | credit
  last4: text("last4"),
  createdAt: text("created_at").notNull(),
});

// ── Import batches (one per imported CSV file) ─────────────────────
export const importBatches = sqliteTable("import_batches", {
  id: text("id").primaryKey(),
  fileName: text("file_name").notNull(),
  sourcePath: text("source_path"), // Where the file sits in the statements folder (files are never moved)
  fileHash: text("file_hash").notNull(), // sha256 of the file: the folder scan skips files already seen
  status: text("status").notNull().default("imported"), // imported | undone (undone files are skipped by the scan)
  format: text("format").notNull(), // chase-card | apple-card | amex | ally
  accountId: text("account_id").notNull(),
  rowCount: integer("row_count").notNull(),
  inserted: integer("inserted").notNull(),
  duplicates: integer("duplicates").notNull(),
  dateFrom: text("date_from"),
  dateTo: text("date_to"),
  importedAt: text("imported_at").notNull(),
});

// ── Transactions (imported from bank / card CSVs) ──────────────────
// Sign convention: negative = money leaving you (purchase, fee, bill paid from checking),
// positive = money coming in (paycheck, refund, a payment received by a card).
export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(), // Hash of account + date + amount + description + occurrence: re-imports dedupe
  accountId: text("account_id").notNull(),
  batchId: text("batch_id").notNull(),
  date: text("date").notNull(), // Transaction date, YYYY-MM-DD
  postedDate: text("posted_date"),
  month: text("month").notNull(), // YYYY-MM
  amount: real("amount").notNull(),
  description: text("description").notNull(), // As the bank wrote it
  merchant: text("merchant").notNull(), // Cleaned up for grouping
  category: text("category").notNull().default("Uncategorized"),
  kind: text("kind").notNull(), // spend | income | refund | transfer | fee | interest
  member: text("member"), // Card member / purchased by, when the bank says
  transferPeerId: text("transfer_peer_id"), // The other side of a transfer between your own accounts
  edited: integer("edited").notNull().default(0), // 1 once category/kind were changed by hand on this transaction
  // What the importer read from the bank, before payees: merchant/category/kind above are
  // recomputed from these plus the matching payee whenever payees or aliases change
  baseMerchant: text("base_merchant"),
  baseCategory: text("base_category"),
  baseKind: text("base_kind"),
  payeeId: text("payee_id"),
  aliasId: text("alias_id"), // The alias that matched, if any
  payeeLocked: integer("payee_locked").notNull().default(0), // 1 = payee picked by hand for this transaction
  raw: text("raw"), // Original CSV row as JSON
  createdAt: text("created_at").notNull(),
});

// ── Payees (one final name for everything that's really the same merchant) ──
export const payees = sqliteTable("payees", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"), // Default category for its transactions
  kind: text("kind"), // Default kind (spend, income, transfer, ...)
  billId: text("bill_id"), // Linked bill on the Bills list
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

// Any statement text that means this payee
export const payeeAliases = sqliteTable("payee_aliases", {
  id: text("id").primaryKey(),
  payeeId: text("payee_id").notNull(),
  pattern: text("pattern").notNull(),
  match: text("match").notNull().default("contains"), // contains | starts | exact | merchant
  amount: real("amount"), // Only match charges of exactly this amount (e.g. Amazon at $14.99 = Prime)
  createdAt: text("created_at").notNull(),
});

// ── Merchant rules (replaced by payees; migrated on startup, kept for reference) ──
// Any transaction whose description contains `pattern` (case-insensitive) gets these values
export const merchantRules = sqliteTable("merchant_rules", {
  id: text("id").primaryKey(),
  pattern: text("pattern").notNull(),
  merchant: text("merchant"),
  category: text("category"),
  kind: text("kind"),
  createdAt: text("created_at").notNull(),
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
export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
export type StatementAccount = typeof statementAccounts.$inferSelect;
export type ImportBatch = typeof importBatches.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type MerchantRule = typeof merchantRules.$inferSelect;
export type Payee = typeof payees.$inferSelect;
export type PayeeAlias = typeof payeeAliases.$inferSelect;
