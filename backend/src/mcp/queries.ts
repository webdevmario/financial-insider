import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { carsOverview, type CarData } from "../lib/cars/compute.js";
import { TARGETS_KEY, holdingsOverview, parseTargets, type HoldingsData } from "../lib/holdings/compute.js";

/**
 * Read-only queries behind the finance MCP. Every function takes a connection
 * opened with `readOnly: true`, so SQLite itself refuses any write.
 *
 * Sign convention (same as the app): negative amount = money leaving you,
 * positive = money coming in. "spent" figures below are flipped to positive.
 */

export type Db = DatabaseSync;

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Kinds that count as spending: purchases, net of refunds, plus fees. Transfers, income and interest are not spending. */
export const SPENDING_KINDS = ["spend", "refund", "fee"];

export interface TxnFilter {
  /** Words in the merchant name or the bank's description (case-insensitive) */
  query?: string;
  categories?: string[];
  kinds?: string[];
  from?: string; // YYYY-MM-DD, inclusive
  to?: string; // YYYY-MM-DD, inclusive
  weekdays?: Weekday[];
  /** Statement account id (from overview) */
  account?: string;
  /** Card member / purchased by, contains */
  member?: string;
  /** Only charges of at least / at most this many dollars spent (purchases only) */
  minSpent?: number;
  maxSpent?: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

function like(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** WHERE clause for a filter over `transactions t` */
function where(f: TxnFilter): { sql: string; params: SQLInputValue[] } {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  if (f.query) {
    parts.push("(t.merchant LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')");
    params.push(like(f.query), like(f.query));
  }
  if (f.categories?.length) {
    parts.push(`t.category COLLATE NOCASE IN (${f.categories.map(() => "?").join(",")})`);
    params.push(...f.categories);
  }
  if (f.kinds?.length) {
    parts.push(`t.kind IN (${f.kinds.map(() => "?").join(",")})`);
    params.push(...f.kinds);
  }
  if (f.from) {
    parts.push("t.date >= ?");
    params.push(f.from);
  }
  if (f.to) {
    parts.push("t.date <= ?");
    params.push(f.to);
  }
  if (f.weekdays?.length) {
    parts.push(`CAST(strftime('%w', t.date) AS INTEGER) IN (${f.weekdays.map(() => "?").join(",")})`);
    params.push(...f.weekdays.map((d) => WEEKDAYS.indexOf(d)));
  }
  if (f.account) {
    parts.push("t.account_id = ?");
    params.push(f.account);
  }
  if (f.member) {
    parts.push("t.member LIKE ? ESCAPE '\\'");
    params.push(like(f.member));
  }
  if (f.minSpent !== undefined) {
    parts.push("-t.amount >= ?");
    params.push(f.minSpent);
  }
  if (f.maxSpent !== undefined) {
    parts.push("-t.amount <= ? AND t.amount < 0");
    params.push(f.maxSpent);
  }
  return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── overview ──────────────────────────────────────────────────────

export function overview(db: Db) {
  const totals = db
    .prepare("SELECT COUNT(*) AS count, MIN(date) AS first, MAX(date) AS last FROM transactions")
    .get() as { count: number; first: string | null; last: string | null };
  const lastImport = db.prepare("SELECT MAX(imported_at) AS at FROM import_batches WHERE status = 'imported'").get() as {
    at: string | null;
  };
  const accounts = db
    .prepare(
      `SELECT a.id, a.name, a.institution, a.kind,
              COUNT(t.id) AS transactions, MIN(t.date) AS first, MAX(t.date) AS last
         FROM statement_accounts a LEFT JOIN transactions t ON t.account_id = a.id
        GROUP BY a.id ORDER BY a.institution, a.name`,
    )
    .all();
  const categories = db
    .prepare(
      `SELECT category, COUNT(*) AS transactions,
              ROUND(-SUM(CASE WHEN kind IN ('spend','refund','fee') THEN amount ELSE 0 END), 2) AS spent
         FROM transactions GROUP BY category ORDER BY transactions DESC`,
    )
    .all();
  const kinds = db.prepare("SELECT kind, COUNT(*) AS transactions FROM transactions GROUP BY kind ORDER BY 2 DESC").all();
  const members = db
    .prepare("SELECT member, COUNT(*) AS transactions FROM transactions WHERE member IS NOT NULL GROUP BY member ORDER BY 2 DESC")
    .all();
  return {
    transactions: totals.count,
    dateRange: { from: totals.first, to: totals.last },
    lastImport: lastImport.at,
    accounts,
    categories,
    kinds,
    members,
  };
}

// ── find_transactions ─────────────────────────────────────────────

export function findTransactions(
  db: Db,
  f: TxnFilter & { sort?: "newest" | "oldest" | "largest"; limit?: number; offset?: number },
) {
  const w = where(f);
  const order = { newest: "t.date DESC, t.id", oldest: "t.date ASC, t.id", largest: "t.amount ASC" }[f.sort ?? "newest"];
  const sum = db
    .prepare(
      `SELECT COUNT(*) AS count,
              ROUND(-SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END), 2) AS outflow,
              ROUND(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 2) AS inflow
         FROM transactions t ${w.sql}`,
    )
    .get(...w.params) as { count: number; outflow: number | null; inflow: number | null };
  const limit = f.limit ?? 50;
  const offset = f.offset ?? 0;
  const rows = db
    .prepare(
      `SELECT t.date, t.amount, t.merchant, t.category, t.kind, a.name AS account, t.member, t.description
         FROM transactions t LEFT JOIN statement_accounts a ON a.id = t.account_id
         ${w.sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...w.params, limit, offset) as { date: string }[];
  return {
    matched: sum.count,
    outflow: sum.outflow ?? 0,
    inflow: sum.inflow ?? 0,
    returned: rows.length,
    hasMore: offset + rows.length < sum.count,
    transactions: rows.map((r) => ({ ...r, weekday: weekdayOf(r.date) })),
  };
}

// ── merchant_history ──────────────────────────────────────────────

export type MerchantSort = "recent" | "visits" | "spent" | "longest_ago";

export function merchantHistory(
  db: Db,
  f: TxnFilter & { minVisits?: number; sort?: MerchantSort; limit?: number; recentDates?: number; today?: string },
) {
  // Purchases only by default: a refund or fee isn't a visit
  const w = where({ ...f, kinds: f.kinds?.length ? f.kinds : ["spend"] });
  const rows = db
    .prepare(`SELECT t.merchant, t.category, t.date, t.amount FROM transactions t ${w.sql} ORDER BY t.date DESC`)
    .all(...w.params) as { merchant: string; category: string; date: string; amount: number }[];

  const today = f.today ?? localToday();
  const byMerchant = new Map<
    string,
    { dates: string[]; charges: number; spent: number; categories: Map<string, number> }
  >();
  for (const r of rows) {
    let m = byMerchant.get(r.merchant);
    if (!m) byMerchant.set(r.merchant, (m = { dates: [], charges: 0, spent: 0, categories: new Map() }));
    // Rows arrive newest first, so dates stays sorted; a tip charged separately on the same day is one visit
    if (m.dates[m.dates.length - 1] !== r.date) m.dates.push(r.date);
    m.charges++;
    m.spent -= r.amount;
    m.categories.set(r.category, (m.categories.get(r.category) ?? 0) + 1);
  }

  const keep = f.recentDates ?? 5;
  let merchants = [...byMerchant.entries()].map(([merchant, m]) => {
    const visits = m.dates.length;
    const lastVisit = m.dates[0];
    const firstVisit = m.dates[visits - 1];
    // Typical gap between visits, for "is it time to go back?"
    const avgGapDays = visits > 1 ? Math.round(daysBetween(firstVisit, lastVisit) / (visits - 1)) : null;
    return {
      merchant,
      category: [...m.categories.entries()].sort((a, b) => b[1] - a[1])[0][0],
      visits,
      charges: m.charges,
      firstVisit,
      lastVisit,
      daysSinceLastVisit: daysBetween(lastVisit, today),
      avgGapDays,
      spent: round(m.spent),
      avgPerVisit: round(m.spent / visits),
      recentVisits: m.dates.slice(0, keep).map((date) => ({ date, weekday: weekdayOf(date) })),
    };
  });
  if (f.minVisits) merchants = merchants.filter((m) => m.visits >= f.minVisits!);

  const sorters: Record<MerchantSort, (a: (typeof merchants)[0], b: (typeof merchants)[0]) => number> = {
    recent: (a, b) => b.lastVisit.localeCompare(a.lastVisit),
    visits: (a, b) => b.visits - a.visits || b.lastVisit.localeCompare(a.lastVisit),
    spent: (a, b) => b.spent - a.spent,
    longest_ago: (a, b) => a.lastVisit.localeCompare(b.lastVisit),
  };
  merchants.sort(sorters[f.sort ?? "recent"]);
  const limit = f.limit ?? 25;
  return { today, matchedMerchants: merchants.length, merchants: merchants.slice(0, limit) };
}

// ── spending_summary ──────────────────────────────────────────────

export type GroupBy = "category" | "merchant" | "month" | "year" | "weekday" | "account";

export function spendingSummary(db: Db, f: TxnFilter & { groupBy: GroupBy; limit?: number }) {
  const w = where({ ...f, kinds: f.kinds?.length ? f.kinds : SPENDING_KINDS });
  const key = {
    category: "t.category",
    merchant: "t.merchant",
    month: "t.month",
    year: "substr(t.date, 1, 4)",
    weekday: "CAST(strftime('%w', t.date) AS INTEGER)",
    account: "COALESCE(a.name, t.account_id)",
  }[f.groupBy];
  // Time groupings read best in order; the rest biggest first
  const order = ["month", "year", "weekday"].includes(f.groupBy) ? "key" : "spent DESC";
  const rows = db
    .prepare(
      `SELECT ${key} AS key, ROUND(-SUM(t.amount), 2) AS spent, COUNT(*) AS transactions
         FROM transactions t LEFT JOIN statement_accounts a ON a.id = t.account_id
         ${w.sql} GROUP BY key ORDER BY ${order}`,
    )
    .all(...w.params) as { key: string | number; spent: number; transactions: number }[];
  const total = round(rows.reduce((s, r) => s + r.spent, 0));
  const limit = f.limit ?? 100;
  return {
    groupBy: f.groupBy,
    kinds: f.kinds?.length ? f.kinds : SPENDING_KINDS,
    total,
    groups: rows.length,
    rows: rows.slice(0, limit).map((r) => ({
      [f.groupBy]: f.groupBy === "weekday" ? WEEKDAYS[r.key as number] : r.key,
      spent: r.spent,
      transactions: r.transactions,
      share: total ? round((r.spent / total) * 100) : 0,
    })),
  };
}

// ── list_bills ────────────────────────────────────────────────────

const PER_MONTH: Record<string, number> = { monthly: 1, quarterly: 1 / 3, annual: 1 / 12 };

export function listBills(db: Db, state: "active" | "paused" | "cancelled" | "all" = "active") {
  const rows = db
    .prepare(
      `SELECT name, category, frequency, amount, split_by AS splitBy, next_charge AS nextCharge,
              status AS tag, COALESCE(state, 'active') AS state, state_since AS stateSince, notes
         FROM subscriptions ORDER BY name`,
    )
    .all() as { amount: number; splitBy: number; frequency: string; state: string }[];
  const bills = rows
    .filter((b) => state === "all" || b.state === state)
    .map((b) => {
      const yourShare = b.amount / (b.splitBy || 1);
      return { ...b, yourShare: round(yourShare), yourShareMonthly: round(yourShare * (PER_MONTH[b.frequency] ?? 1)) };
    });
  const active = bills.filter((b) => b.state === "active");
  return {
    note: "Amounts are the listed amounts on the Bills page; yourShare divides by splitBy.",
    count: bills.length,
    activeMonthlyTotal: round(active.reduce((s, b) => s + b.yourShareMonthly, 0)),
    bills,
  };
}

// ── net_worth ─────────────────────────────────────────────────────

export function netWorth(db: Db) {
  const accounts = db
    .prepare(
      `SELECT type, institution, owner, balance, home_value AS homeValue, mortgage_balance AS mortgageBalance,
              last_updated AS lastUpdated, notes
         FROM accounts ORDER BY balance DESC`,
    )
    .all() as { type: string; balance: number }[];
  const byType = new Map<string, number>();
  for (const a of accounts) byType.set(a.type, (byType.get(a.type) ?? 0) + a.balance);
  return {
    note: "Balances are typed in by hand on the Assets page; check lastUpdated before relying on one.",
    total: round(accounts.reduce((s, a) => s + a.balance, 0)),
    byType: [...byType.entries()].map(([type, balance]) => ({ type, balance: round(balance) })),
    accounts,
  };
}

// ── run_sql ───────────────────────────────────────────────────────

export class QueryError extends Error {}

export function runSql(db: Db, sql: string, maxRows = 200) {
  const text = sql.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(text)) throw new QueryError("Only a single SELECT (or WITH … SELECT) statement is allowed.");
  if (text.includes(";")) throw new QueryError("One statement at a time.");
  const stmt = db.prepare(text);
  const rows: unknown[] = [];
  let truncated = false;
  for (const row of stmt.iterate()) {
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    rows.push(row);
  }
  return { columns: stmt.columns().map((c) => c.name), rowCount: rows.length, truncated, rows };
}

// ── cars ──────────────────────────────────────────────────────────

/**
 * Rows for the car math, read with the same column names the app uses. Before the app has created
 * the car tables (the server adds them on its next start), there are simply no cars.
 */
export function loadCarData(db: Db, today = localToday()): CarData {
  const has = (table: string) =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  const all = <T>(sql: string): T[] => db.prepare(sql).all() as T[];
  const carTables = has("vehicles") && has("vehicle_documents") && has("vehicle_links") && has("vehicle_rules");
  return {
    cars: carTables
      ? all(`SELECT id, name, year, make, model, vin, plate, driver, account_id AS accountId, purchase_date AS purchaseDate,
                    purchase_price AS purchasePrice, purchase_mileage AS purchaseMileage, purchased_from AS purchasedFrom,
                    trade_in_value AS tradeInValue, loan_amount AS loanAmount, loan_rate AS loanRate, loan_months AS loanMonths,
                    interest_paid AS interestPaid, sold_date AS soldDate, sale_price AS salePrice, sale_mileage AS saleMileage,
                    value_estimate AS valueEstimate, value_date AS valueDate, notes, created_at AS createdAt
               FROM vehicles`)
      : [],
    links: carTables
      ? all(`SELECT id, transaction_id AS transactionId, vehicle_id AS vehicleId, share, cost_type AS costType, created_at AS createdAt
               FROM vehicle_links`)
      : [],
    rules: carTables
      ? all(`SELECT id, match_type AS matchType, match_value AS matchValue, cost_type AS costType, shares,
                    date_from AS dateFrom, date_to AS dateTo, notes, created_at AS createdAt
               FROM vehicle_rules`)
      : [],
    docs: carTables
      ? all(`SELECT id, file_name AS fileName, source_path AS sourcePath, file_hash AS fileHash, size, status,
                    vehicle_id AS vehicleId, doc_type AS docType, date, vendor, odometer, total, summary, items, details,
                    transaction_id AS transactionId, paid_outside AS paidOutside, notes, added_at AS addedAt, updated_at AS updatedAt
               FROM vehicle_documents`)
      : [],
    txns: all(`SELECT id, date, month, amount, merchant, category, kind, payee_id AS payeeId FROM transactions`),
    assets: all(`SELECT id, type, balance, last_updated AS lastUpdated, institution, owner FROM accounts`),
    goals: all(`SELECT name, target_amount AS targetAmount, saved_amount AS savedAmount, deadline, priority,
                       completed_at AS completedAt FROM goals`),
    today,
  };
}

/** Each car's costs, the gaps in the data, and the household numbers an upgrade decision needs */
export function carCosts(db: Db, today?: string) {
  const data = loadCarData(db, today);
  const overview = carsOverview(data);
  return {
    note:
      "Cost of ownership = running costs (charges assigned to a car, shared costs split by rules, documents paid outside " +
      "the imported accounts) + depreciation (purchase price minus current value) + loan interest. Purchase and loan " +
      "payments are counted through the price, not as running costs. Current value comes from the car's Vehicle asset.",
    ...overview,
    // Service history per car: what was done, when, at what mileage
    documents: data.docs
      .filter((d) => d.status === "done")
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .map((d) => ({
        vehicleId: d.vehicleId, date: d.date, type: d.docType, vendor: d.vendor, odometer: d.odometer, total: d.total,
        summary: d.summary, items: d.items ? JSON.parse(d.items) : [], details: d.details ? JSON.parse(d.details) : null,
      })),
  };
}

// ── holdings ──────────────────────────────────────────────────────

/** Rows for the holdings math. Before the app has created the tables (on its next start), nothing is held. */
export function loadHoldingsData(db: Db, asOf?: string): HoldingsData {
  const has = (table: string) =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  const all = <T>(sql: string): T[] => db.prepare(sql).all() as T[];
  const tables = has("securities") && has("holdings");
  const targetsRow = has("settings")
    ? (db.prepare("SELECT value FROM settings WHERE key = ?").get(TARGETS_KEY) as { value: string } | undefined)
    : undefined;
  let rawTargets: unknown = null;
  try {
    rawTargets = targetsRow ? JSON.parse(targetsRow.value) : null;
  } catch {
    rawTargets = null;
  }
  return {
    securities: tables
      ? all(`SELECT id, symbol, name, kind, asset_class AS assetClass, role, status, expense_ratio AS expenseRatio, why, notes,
                    created_at AS createdAt, updated_at AS updatedAt FROM securities`)
      : [],
    holdings: tables
      ? all(`SELECT id, account_id AS accountId, security_id AS securityId, as_of AS asOf, shares, value, cost_basis AS costBasis,
                    role, created_at AS createdAt FROM holdings`)
      : [],
    accounts: all(`SELECT id, type, owner, institution, balance, last_updated AS lastUpdated FROM accounts`),
    targets: parseTargets(rawTargets),
    asOf,
  };
}

/** What each account holds (latest snapshot), the household mix against the written targets, and what to look at */
export function investmentHoldings(db: Db, asOf?: string) {
  return {
    note:
      "Values are typed from each broker on the snapshot date (usually the 1st); there are no live prices. Each account " +
      "uses its latest snapshot on or before asOf. securities is the household's list: status keep / watch / remove and " +
      "role core / play are decisions, not market data. Play money counts against playCap. Education and planning only.",
    ...holdingsOverview(loadHoldingsData(db, asOf)),
  };
}
