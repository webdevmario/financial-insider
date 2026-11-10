/**
 * The mid-month plan: what's really free to spend from the 16th to month-end.
 *
 * The second half of each month gets its own budget. On the 15th you take the
 * checking balance and set aside:
 * - bills due from the 16th to month-end (projected amounts, by due date)
 * - card charges from the first half that haven't posted yet. Cards are paid
 *   as soon as charges post, so these are what still has to leave checking.
 *   Most of them are bills charged on or just before the 15th; the rest is the
 *   last day or two of everyday card spending, which hasn't posted yet
 * - money set aside for savings first (entered on the page; carries forward)
 * Work expenses due in the window are listed but left out: they're reimbursed
 * on the 1st.
 *
 * This module only suggests lines from the data; the page lets every amount be
 * changed and every line switched off.
 */
import { db } from "../../db/index.js";
import { payees, statementAccounts, subscriptions, transactions, type Subscription, type Transaction } from "../../db/schema.js";
import { isActiveBill } from "../bills.js";
import { today } from "../date.js";
import { billCharges, isCost } from "./bill-match.js";
import { computeBillProjections, projectedAmount } from "./projection.js";

const REIMBURSED = "Work (Reimbursed)";
const STEP_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };

const round = (n: number) => Math.round(n * 100) / 100;
const days = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const dateIn = (month: string, day: number) => `${month}-${String(Math.min(day, lastDay(month))).padStart(2, "0")}`;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The day this bill charges in `month`, or null when it doesn't charge that month */
function chargeDayIn(bill: Subscription, month: string, charges: Transaction[]): number | null {
  const step = STEP_MONTHS[bill.frequency] ?? 1;
  if (bill.nextCharge) {
    const [y, m, d] = bill.nextCharge.split("-").map(Number);
    const [ty, tm] = month.split("-").map(Number);
    const diff = (ty - y) * 12 + (tm - m);
    return ((diff % step) + step) % step === 0 ? d : null;
  }
  // No date on the bill: monthly bills charge on their usual day; others can't be placed
  if (step !== 1) return null;
  const recent = charges.slice(-6).map((t) => Number(t.date.slice(8, 10)));
  return recent.length ? Math.round(median(recent)) : null;
}

export interface PlanLine {
  key: string;
  label: string;
  amount: number;
  /** Plain words on where the number comes from */
  note: string;
  date?: string;
}

export function computeMidMonthPlan(month = today().slice(0, 7)) {
  const all = db.select().from(transactions).all();
  const bills = db.select().from(subscriptions).all().filter(isActiveBill);
  const payeeList = db.select().from(payees).all();
  const cards = db.select().from(statementAccounts).all().filter((a) => a.kind === "credit");
  const projections = computeBillProjections(month);
  const asOf = all.reduce((max, t) => (t.date > max ? t.date : max), "") || today();
  const fifteenth = `${month}-15`;
  const windowStart = `${month}-16`;
  const windowEnd = dateIn(month, 31);

  const billLines: PlanLine[] = [];
  const pendingLines: PlanLine[] = [];
  const billChargeIds = new Set<string>();

  for (const b of bills) {
    const { charges } = billCharges(b, all, payeeList);
    for (const t of charges) billChargeIds.add(t.id);
    const day = chargeDayIn(b, month, charges);
    if (day == null) continue;
    const date = dateIn(month, day);
    const amount = projectedAmount(b, projections);
    const shared = b.splitBy > 1 ? ` · shared, your part ${round(amount / b.splitBy).toFixed(2)}` : "";
    const chargedThisMonth = charges.some((t) => t.month === month);
    if (date >= windowStart) {
      // Already charged in the window means it's already out of checking
      if (charges.some((t) => t.date >= windowStart && t.month === month)) continue;
      billLines.push({ key: `bill:${b.id}`, label: b.name, amount, date, note: `${b.frequency}${shared}` });
    } else if (!chargedThisMonth) {
      // A first-half bill that isn't in the data yet: a card charge still pending, or one not uploaded
      pendingLines.push({ key: `pending-bill:${b.id}`, label: b.name, amount, date, note: "Bill due by the 15th, not in your data yet" });
    }
  }
  billLines.sort((a, b) => a.date!.localeCompare(b.date!));
  pendingLines.sort((a, b) => a.date!.localeCompare(b.date!));

  // Everyday card spending that hasn't posted: a card's usual posting lag, or the days since its last upload
  const since = (() => {
    const d = new Date(Date.UTC(...(fifteenth.split("-").map(Number) as [number, number, number])));
    d.setUTCDate(d.getUTCDate() - 90);
    return d.toISOString().slice(0, 10);
  })();
  for (const card of cards) {
    const rows = all.filter((t) => t.accountId === card.id);
    if (!rows.length) continue;
    const lags = rows.filter((t) => t.postedDate && t.date >= since).map((t) => days(t.postedDate!) - days(t.date));
    const lag = lags.length ? Math.max(1, Math.round(median(lags))) : 2;
    const lastData = rows.reduce((max, t) => (t.date > max ? t.date : max), "");
    const unposted = Math.max(lag, Math.min(15, days(fifteenth) - days(lastData)));
    const everyday = rows
      .filter((t) => t.date >= since && t.date <= fifteenth && isCost(t) && !billChargeIds.has(t.id) && t.category !== REIMBURSED)
      .reduce((s, t) => s - t.amount, 0);
    const daily = everyday / 90;
    const amount = Math.round((daily * unposted) / 5) * 5;
    if (amount <= 0) continue;
    pendingLines.push({
      key: `pending-card:${card.id}`,
      label: `${card.name} everyday spending`,
      amount,
      note: `About ${unposted} day${unposted === 1 ? "" : "s"} not posted yet at ~$${Math.round(daily)}/day`,
    });
  }

  // Work expenses expected in the window: reimbursed on the 1st, so listed but left out by default
  const workLines: PlanLine[] = [];
  const yearAgo = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
  const byPayee = new Map<string, Transaction[]>();
  for (const t of all) {
    if (t.category !== REIMBURSED || !isCost(t)) continue;
    const k = t.payeeId ?? t.merchant;
    (byPayee.get(k) ?? byPayee.set(k, []).get(k)!).push(t);
  }
  for (const rows of byPayee.values()) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const last = rows[rows.length - 1];
    const recentMonths = new Set(rows.filter((t) => days(t.date) >= days(asOf) - 125).map((t) => t.month));
    const name = last.merchant;
    if (rows.some((t) => t.month === month && t.date >= windowStart)) continue;
    if (recentMonths.size >= 3) {
      const day = Math.round(median(rows.slice(-6).map((t) => Number(t.date.slice(8, 10)))));
      if (day >= 16) workLines.push({ key: `work:${name}`, label: name, amount: round(-last.amount), date: dateIn(month, day), note: "Monthly" });
    } else {
      const lastYear = rows.filter((t) => t.month === yearAgo && t.date.slice(8, 10) >= "16");
      if (lastYear.length) {
        const t = lastYear[lastYear.length - 1];
        workLines.push({ key: `work:${name}`, label: name, amount: round(-t.amount), date: dateIn(month, Number(t.date.slice(8, 10))), note: "Charged this month last year" });
      }
    }
  }
  workLines.sort((a, b) => a.date!.localeCompare(b.date!));

  return {
    month,
    window: { start: windowStart, end: windowEnd },
    asOf,
    /** Data should run through the 15th for the pending estimate to be tight */
    dataComplete: asOf >= fifteenth,
    bills: billLines,
    pending: pendingLines,
    work: workLines,
  };
}
