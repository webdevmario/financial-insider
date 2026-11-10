/**
 * The Dashboard's read on spending: how this month is pacing against a typical
 * month, fixed (bill) vs flexible spending, categories running hot, and how
 * this year compares with the two before it.
 *
 * Spending is net of refunds. Two categories are kept out of it:
 * "Work (Reimbursed)" is paid back, and "Savings" is money set aside (extra
 * mortgage principal, for example), so neither makes spending look higher.
 */
import { db } from "../../db/index.js";
import { payees, subscriptions, transactions, type Transaction } from "../../db/schema.js";
import { today } from "../date.js";
import { billCharges, isCost } from "./bill-match.js";

const REIMBURSED = "Work (Reimbursed)";
const SAVINGS = "Savings";

const round = (n: number) => Math.round(n * 100) / 100;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

const isRefund = (t: Transaction) => t.kind === "refund" || (t.kind === "spend" && t.amount > 0);

/** What a row adds to spending: costs count, refunds take back */
function spendOf(t: Transaction): number {
  if (isCost(t) || isRefund(t)) return -t.amount;
  return 0;
}

type Bucket = {
  spent: number; income: number; saved: number; reimbursed: number; fixed: number;
  byCategory: Map<string, number>;
  /** Flexible (non-bill) spending only, so a bill landing on its due date doesn't read as running hot */
  flexByCategory: Map<string, number>;
};
const emptyBucket = (): Bucket => ({ spent: 0, income: 0, saved: 0, reimbursed: 0, fixed: 0, byCategory: new Map(), flexByCategory: new Map() });

function add(b: Bucket, t: Transaction, fixedIds: Set<string>) {
  // Money set aside counts as saved whatever its kind (a payee can mark it a transfer to keep it out of spending everywhere)
  if (t.category === SAVINGS) {
    b.saved -= t.amount;
    return;
  }
  if (t.kind === "income" && t.amount > 0) {
    b.income += t.amount;
    return;
  }
  const s = spendOf(t);
  if (!s) return;
  if (t.category === REIMBURSED) b.reimbursed += s;
  else {
    b.spent += s;
    b.byCategory.set(t.category, (b.byCategory.get(t.category) || 0) + s);
    if (fixedIds.has(t.id)) b.fixed += s;
    else b.flexByCategory.set(t.category, (b.flexByCategory.get(t.category) || 0) + s);
  }
}

export function computePulse() {
  const all = db.select().from(transactions).all();
  const bills = db.select().from(subscriptions).all();
  const payeeList = db.select().from(payees).all();
  const asOf = all.reduce((max, t) => (t.date > max ? t.date : max), "") || today();
  const month = asOf.slice(0, 7);
  const day = asOf.slice(8, 10);

  // Charges that belong to a bill count as fixed spending
  const fixedIds = new Set<string>();
  for (const b of bills) for (const t of billCharges(b, all, payeeList).charges) fixedIds.add(t.id);

  // Per month: the whole month, and the same month only through today's day
  const full = new Map<string, Bucket>();
  const toDay = new Map<string, Bucket>();
  for (const t of all) {
    const f = full.get(t.month) ?? full.set(t.month, emptyBucket()).get(t.month)!;
    add(f, t, fixedIds);
    if (t.date.slice(8, 10) <= day) {
      const d = toDay.get(t.month) ?? toDay.set(t.month, emptyBucket()).get(t.month)!;
      add(d, t, fixedIds);
    }
  }

  // ── This month against the last 12 complete months ──
  const past = Array.from({ length: 12 }, (_, i) => shiftMonth(month, -12 + i)).filter((m) => full.has(m));
  const now = toDay.get(month) ?? emptyBucket();
  const rest = (pick: (b: Bucket) => number) =>
    median(past.map((m) => pick(full.get(m)!) - pick(toDay.get(m) ?? emptyBucket())));
  const spentOnPace = now.spent + rest((b) => b.spent);
  const incomeOnPace = now.income + rest((b) => b.income);

  // Flexible categories furthest above their usual pace for this point in the month
  const categories = new Set(past.flatMap((m) => [...(toDay.get(m)?.flexByCategory.keys() ?? [])]).concat([...now.flexByCategory.keys()]));
  const hot = [...categories]
    .map((category) => {
      const current = now.flexByCategory.get(category) || 0;
      const usual = median(past.map((m) => toDay.get(m)?.flexByCategory.get(category) || 0));
      return { category, current: round(current), usual: round(usual), diff: round(current - usual) };
    })
    .filter((c) => c.diff >= 40 && c.current >= c.usual * 1.25)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3);

  const pulse = {
    month,
    asOf,
    spent: round(now.spent),
    usualSpentByNow: round(median(past.map((m) => toDay.get(m)?.spent ?? 0))),
    spentOnPace: round(spentOnPace),
    usualMonth: round(median(past.map((m) => full.get(m)!.spent))),
    income: round(now.income),
    incomeOnPace: round(incomeOnPace),
    netOnPace: round(incomeOnPace - spentOnPace),
    saved: round(now.saved),
    reimbursed: round(now.reimbursed),
    hot,
    // Fixed vs flexible for the last 12 complete months and this month so far
    split: [...past, month].map((m) => {
      const b = m === month ? now : full.get(m)!;
      return { month: m, fixed: round(b.fixed), flexible: round(b.spent - b.fixed), partial: m === month };
    }),
  };

  // ── Year over year: this year and the two before, month by month ──
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

  return { pulse, yoy: { through: asOf.slice(5), years: yoy.map(({ categories, ...rest }) => rest), changes } };
}
