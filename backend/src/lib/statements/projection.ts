/**
 * What each bill is expected to cost, from its real charges. Totals use these
 * instead of the amount typed on the bill, unless the bill is pinned to it.
 *
 * - Monthly bills are summed per calendar month (a per-visit bill can charge
 *   several times a month), using complete months only. In order:
 *   1. The last three months charged about the same (within 3%): that's the
 *      current price, so it's what the bill costs. Price changes carry forward,
 *      and an odd month further back (a one-off extra, a short billing month)
 *      doesn't matter.
 *   2. A real yearly pattern (utilities): two years of history whose months
 *      rise and fall together, with a sizable swing. Then the same month last
 *      year, scaled by how the last three months compare with a year earlier.
 *   3. Otherwise a typical month: the median of the last 12.
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

/** The last three months within 3% of each other: the bill has a current price */
function settled(values: number[]): boolean {
  if (values.length < 3) return values.length > 0 && values.every((v) => Math.abs(v - values[0]) <= values[0] * 0.03);
  const last3 = values.slice(-3);
  const hi = Math.max(...last3);
  const lo = Math.min(...last3);
  return lo > 0 && (hi - lo) / hi <= 0.03;
}

/** Pearson correlation of two equal-length series */
function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db2 = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db2 += (b[i] - mb) ** 2;
  }
  return da && db2 ? num / Math.sqrt(da * db2) : 0;
}

/**
 * A genuine yearly pattern: the last 12 months and the 12 before them move
 * together month by month (correlation 0.6 or more over at least 10 matching
 * months), and the swing is sizable (top-to-bottom at least 30% of a typical
 * month). One unusual month in one year can't pass this.
 */
function seasonal(totals: Map<string, number>, lastComplete: string): boolean {
  const recent: number[] = [];
  const before: number[] = [];
  for (let i = 0; i < 12; i++) {
    const m = shiftMonth(lastComplete, -i);
    const prev = shiftMonth(m, -12);
    if (totals.has(m) && totals.has(prev)) {
      recent.push(totals.get(m)!);
      before.push(totals.get(prev)!);
    }
  }
  if (recent.length < 10) return false;
  const swing = (Math.max(...recent) - Math.min(...recent)) / median(recent);
  return swing >= 0.3 && correlation(recent, before) >= 0.6;
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
  if (settled(values)) {
    return { amount: round(values[values.length - 1]), method: "last", basis: `Current price: ${monthLabel(lastMonth)} charges`, reason: null, history };
  }

  // A real yearly pattern: same month last year, nudged by the recent trend
  const yearAgo = shiftMonth(target, -12);
  const sameMonth = totals.get(yearAgo);
  if (sameMonth && seasonal(totals, lastComplete)) {
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

  // A typical month, not the mean, so one unusual month doesn't drag the number
  return { amount: round(median(values)), method: "average", basis: `Typical month of the last ${values.length}`, reason: null, history };
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
