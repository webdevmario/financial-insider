/**
 * What each bill is expected to cost, from its real charges. Totals use these
 * instead of the amount typed on the bill, unless the bill is pinned to it.
 *
 * - Monthly bills are summed per calendar month (a per-visit bill can charge
 *   several times a month), using complete months only.
 *   - Steady ones project last month's total, so price changes carry forward.
 *   - Variable ones (utilities) project the same month last year, scaled by
 *     how the last three months compare with a year earlier, or failing that
 *     the average of the last 12 months.
 * - Quarterly and annual bills project their last charge.
 * - With no usable history, or charges that don't fit the bill's frequency
 *   (a name match catching the wrong merchant), the listed amount stands.
 */
import { db } from "../../db/index.js";
import { payees, subscriptions, transactions, type Subscription, type Transaction } from "../../db/schema.js";
import { today } from "../date.js";
import { billCharges } from "./bill-match.js";

export type ProjectionMethod = "last" | "seasonal" | "average" | "listed";

export interface BillProjection {
  /** Projected full charge (before any split): this month's for monthly bills, the next charge's otherwise */
  amount: number;
  method: ProjectionMethod;
  /** Plain words on where the number comes from */
  basis: string;
  /** Why history gives no number, when it doesn't */
  reason: "no-history" | "mismatch" | null;
  /** Monthly totals (monthly bills) or single charges (others), oldest first, at most 12 */
  history: { label: string; amount: number }[];
}

const round = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function days(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Spread relative to the mean */
function variation(values: number[]): number {
  const mean = values.reduce((s, n) => s + n, 0) / values.length;
  if (!mean) return 0;
  const sd = Math.sqrt(values.reduce((s, n) => s + (n - mean) ** 2, 0) / values.length);
  return sd / mean;
}

/**
 * A fixed bill: barely moves across the year, or has settled on one amount for
 * the last three months after a price change, without big swings (a seasonal
 * bill can sit flat for a few summer months, so swings rule that out)
 */
function isSteady(values: number[]): boolean {
  if (values.length < 3 || variation(values) < 0.08) return true;
  const last = values[values.length - 1];
  let run = 0;
  for (let i = values.length - 1; i >= 0 && Math.abs(values[i] - last) <= last * 0.02; i--) run++;
  return run >= 3 && Math.max(...values) / Math.min(...values) < 1.6;
}

/** Median days between charges that fits each frequency */
const GAP_RANGE: Record<string, [number, number]> = { quarterly: [60, 130], annual: [250, 450] };

export function projectBill(
  bill: Pick<Subscription, "amount" | "frequency">,
  charges: Transaction[],
  latestData: string,
  target = today().slice(0, 7)
): BillProjection {
  const listed = (reason: BillProjection["reason"], basis: string, history: BillProjection["history"]): BillProjection => ({
    amount: bill.amount,
    method: "listed",
    basis,
    reason,
    history,
  });

  if (bill.frequency !== "monthly") {
    const history = charges.slice(-12).map((t) => ({ label: t.date, amount: round(-t.amount) }));
    const last = charges[charges.length - 1];
    if (!last) return listed("no-history", "Listed amount: no charges found", history);
    const recent = charges.slice(-6);
    const range = GAP_RANGE[bill.frequency];
    if (range && recent.length >= 3) {
      const gap = median(recent.slice(1).map((t, i) => days(t.date) - days(recent[i].date)));
      if (gap < range[0] || gap > range[1]) {
        return listed("mismatch", `Listed amount: the charges found don't look ${bill.frequency}`, history);
      }
    }
    return { amount: round(-last.amount), method: "last", basis: `Last charge, ${monthLabel(last.date.slice(0, 7))}`, reason: null, history };
  }

  // Monthly: totals per complete calendar month
  const lastComplete = shiftMonth(latestData.slice(0, 7), -1);
  const totals = new Map<string, number>();
  for (const t of charges) {
    if (t.month > lastComplete) continue;
    totals.set(t.month, (totals.get(t.month) || 0) - t.amount);
  }
  const windowStart = shiftMonth(lastComplete, -11);
  const recentMonths = [...totals.keys()].filter((m) => m >= windowStart).sort();
  const history = recentMonths.map((m) => ({ label: m, amount: round(totals.get(m)!) }));

  if (!recentMonths.length) {
    return listed("no-history", charges.length ? "Listed amount: no charges in the last year" : "Listed amount: no charges found", history);
  }

  const values = recentMonths.map((m) => totals.get(m)!);
  const lastMonth = recentMonths[recentMonths.length - 1];
  if (isSteady(values)) {
    return { amount: round(values[values.length - 1]), method: "last", basis: `${monthLabel(lastMonth)} charges`, reason: null, history };
  }

  // Variable: same month last year, nudged by the recent trend
  const yearAgo = shiftMonth(target, -12);
  const sameMonth = totals.get(yearAgo);
  if (sameMonth) {
    const last3 = [0, 1, 2].map((i) => shiftMonth(lastComplete, -i));
    const prior3 = last3.map((m) => shiftMonth(m, -12));
    let factor = 1;
    if ([...last3, ...prior3].every((m) => totals.has(m))) {
      const now = last3.reduce((s, m) => s + totals.get(m)!, 0);
      const then = prior3.reduce((s, m) => s + totals.get(m)!, 0);
      factor = Math.min(1.25, Math.max(0.8, now / then));
    }
    const pct = Math.round((factor - 1) * 100);
    return {
      amount: round(sameMonth * factor),
      method: "seasonal",
      basis: pct ? `${monthLabel(yearAgo)} charges, ${pct > 0 ? "+" : ""}${pct}% recent trend` : `${monthLabel(yearAgo)} charges`,
      reason: null,
      history,
    };
  }

  const avg = values.reduce((s, n) => s + n, 0) / values.length;
  return { amount: round(avg), method: "average", basis: `Average of the last ${values.length} months`, reason: null, history };
}

/** Every bill's projection, keyed by bill id */
export function computeBillProjections(target?: string): Map<string, BillProjection> {
  const all = db.select().from(transactions).all();
  const bills = db.select().from(subscriptions).all();
  const payeeList = db.select().from(payees).all();
  const latestData = all.reduce((max, t) => (t.date > max ? t.date : max), "") || today();
  return new Map(bills.map((b) => [b.id, projectBill(b, billCharges(b, all, payeeList).charges, latestData, target)]));
}

/** What a bill counts for in totals: its projection, unless pinned to the listed amount */
export function projectedAmount(bill: Pick<Subscription, "id" | "amount" | "amountMode">, projections: Map<string, BillProjection>): number {
  if (bill.amountMode === "listed") return bill.amount;
  return projections.get(bill.id)?.amount ?? bill.amount;
}
