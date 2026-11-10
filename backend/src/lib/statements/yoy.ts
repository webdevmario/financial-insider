/**
 * How this year's spending compares with the two years before it: running
 * totals by month, the same stretch of each year (Jan 1 to the latest data),
 * full-year totals, and the categories that moved most since last year.
 *
 * Spending is net of refunds. Two categories are kept out of it:
 * "Work (Reimbursed)" is paid back, and "Savings" is money set aside (an extra
 * loan payment, for example), so neither makes spending look higher.
 */
import { db } from "../../db/index.js";
import { payees, transactions, type Transaction } from "../../db/schema.js";
import { today } from "../date.js";
import { isCost } from "./bill-match.js";

const REIMBURSED = "Work (Reimbursed)";
const SAVINGS = "Savings";

const round = (n: number) => Math.round(n * 100) / 100;

const isRefund = (t: Transaction) => t.kind === "refund" || (t.kind === "spend" && t.amount > 0);

/** What a row adds to spending: costs count, refunds take back */
function spendOf(t: Transaction): number {
  if (isCost(t) || isRefund(t)) return -t.amount;
  return 0;
}

type Bucket = { spent: number; income: number; saved: number; byCategory: Map<string, number> };
const emptyBucket = (): Bucket => ({ spent: 0, income: 0, saved: 0, byCategory: new Map() });

function add(b: Bucket, t: Transaction, savingsPayees: Set<string>) {
  // Money set aside counts as saved whatever its kind. A Savings payee can be a transfer (out of spending
  // everywhere), and transfers its aliases pick up are filed as "Transfer", so the payee decides too
  if (t.category === SAVINGS || (t.payeeId && savingsPayees.has(t.payeeId))) {
    b.saved -= t.amount;
    return;
  }
  if (t.kind === "income" && t.amount > 0) {
    b.income += t.amount;
    return;
  }
  const s = spendOf(t);
  if (!s || t.category === REIMBURSED) return;
  b.spent += s;
  b.byCategory.set(t.category, (b.byCategory.get(t.category) || 0) + s);
}

export function computeYearOverYear() {
  const all = db.select().from(transactions).all();
  const payeeList = db.select().from(payees).all();
  const asOf = all.reduce((max, t) => (t.date > max ? t.date : max), "") || today();
  const month = asOf.slice(0, 7);
  const day = asOf.slice(8, 10);
  const savingsPayees = new Set(payeeList.filter((p) => p.category === SAVINGS).map((p) => p.id));

  // Per month: the whole month, and the same month only through the latest day
  const full = new Map<string, Bucket>();
  const toDay = new Map<string, Bucket>();
  for (const t of all) {
    const f = full.get(t.month) ?? full.set(t.month, emptyBucket()).get(t.month)!;
    add(f, t, savingsPayees);
    if (t.date.slice(8, 10) <= day) {
      const d = toDay.get(t.month) ?? toDay.set(t.month, emptyBucket()).get(t.month)!;
      add(d, t, savingsPayees);
    }
  }

  const year = Number(month.slice(0, 4));
  const years = [year - 2, year - 1, year].filter((y) => [...full.keys()].some((m) => m.startsWith(String(y))));
  const throughMonth = Number(month.slice(5, 7));
  const yoy = years.map((y) => {
    const months = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
    const monthly = months.map((m) => {
      if (y === year && m > month) return null;
      const b = full.get(m);
      return b ? round(b.spent) : 0;
    });
    // Same stretch of the year as today (Jan 1 through this month and day), for a fair comparison
    const ytd = emptyBucket();
    const ytdCategories = new Map<string, number>();
    for (const m of months.slice(0, throughMonth)) {
      const b = m.slice(5, 7) === month.slice(5, 7) ? toDay.get(m) : full.get(m);
      if (!b) continue;
      ytd.spent += b.spent;
      ytd.income += b.income;
      ytd.saved += b.saved;
      for (const [c, v] of b.byCategory) ytdCategories.set(c, (ytdCategories.get(c) || 0) + v);
    }
    const fullYear = months.reduce((s, m) => s + (full.get(m)?.spent ?? 0), 0);
    const fullIncome = months.reduce((s, m) => s + (full.get(m)?.income ?? 0), 0);
    const complete = y < year;
    return {
      year: y,
      monthly,
      ytd: { spent: round(ytd.spent), income: round(ytd.income), saved: round(ytd.saved), net: round(ytd.income - ytd.spent) },
      fullYear: complete ? { spent: round(fullYear), income: round(fullIncome), net: round(fullIncome - fullYear) } : null,
      categories: Object.fromEntries([...ytdCategories].map(([c, v]) => [c, round(v)])),
    };
  });

  // Biggest category changes this year vs last, over the same stretch
  const [prev, cur] = yoy.slice(-2);
  const changes =
    prev && cur && cur.year === year
      ? [...new Set([...Object.keys(prev.categories), ...Object.keys(cur.categories)])]
          .map((category) => ({
            category,
            before: prev.categories[category] || 0,
            now: cur.categories[category] || 0,
            diff: round((cur.categories[category] || 0) - (prev.categories[category] || 0)),
          }))
          .filter((c) => Math.abs(c.diff) >= 100)
          .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
          .slice(0, 6)
      : [];

  return { through: asOf.slice(5), years: yoy.map(({ categories, ...rest }) => rest), changes };
}
