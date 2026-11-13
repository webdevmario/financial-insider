/**
 * The mid-month plan: what's really free to spend from the 16th to month-end.
 *
 * You prep on the 15th (the paycheck has usually landed by then), enter the checking
 * balance, and set aside:
 * - bills that haven't charged yet this month (projected amounts, by their usual day).
 *   A bill whose charge already shows up is already out of checking, even if it came early
 * - what each card still owes: posted charges not paid yet (exact, from the card's
 *   statement data, since cards are paid as charges post) plus a small estimate for
 *   spending that hasn't posted or been downloaded yet
 * - money set aside first: savings like an extra loan payment (carries forward), and
 *   anything else held back this month (a project fund)
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
  // Monthly bills: the day they've actually been charging lately beats a date typed in long ago
  if (step === 1) {
    const recent = charges.slice(-6).map((t) => Number(t.date.slice(8, 10)));
    if (recent.length >= 2 || !bill.nextCharge) return recent.length ? Math.round(median(recent)) : null;
  }
  if (!bill.nextCharge) return null;
  const [y, m, d] = bill.nextCharge.split("-").map(Number);
  const [ty, tm] = month.split("-").map(Number);
  const diff = (ty - y) * 12 + (tm - m);
  return ((diff % step) + step) % step === 0 ? d : null;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthDay = (date: string) => `${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;

const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

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
  const accounts = db.select().from(statementAccounts).all();
  const cards = accounts.filter((a) => a.kind === "credit");
  const projections = computeBillProjections(month);
  const now = today();
  const windowEnd = dateIn(month, 31);
  const inMonth = (t: Transaction) => t.month === month;

  // The mid-month paycheck, which often lands a day or few before the 15th
  const payday =
    all
      .filter((t) => inMonth(t) && t.kind === "income" && t.category === "Paycheck" && t.amount > 0)
      .filter((t) => Number(t.date.slice(8, 10)) >= 8 && Number(t.date.slice(8, 10)) <= 20)
      .sort((a, b) => a.date.localeCompare(b.date))
      .pop() ?? null;
  const windowStart = `${month}-16`;
  // The day the balance is taken: the 15th, or today when prepping late
  const prepDay = now.slice(0, 7) === month && now > `${month}-15` ? now : `${month}-15`;
  const seenThrough = now.slice(0, 7) === month ? now : prepDay;

  const billLines: PlanLine[] = [];
  const billChargeIds = new Set<string>();

  for (const b of bills) {
    const { charges } = billCharges(b, all, payeeList);
    for (const t of charges) billChargeIds.add(t.id);
    const day = chargeDayIn(b, month, charges);
    if (day == null) continue;
    const date = dateIn(month, day);
    // Charged already this cycle (early, late, or on the day): it's out of checking
    const step = STEP_MONTHS[b.frequency] ?? 1;
    const from = addDays(date, step === 1 ? -12 : -20);
    const already = charges.find((t) => t.date >= from && t.date <= windowEnd);
    if (already) continue;
    const amount = projectedAmount(b, projections);
    const shared = b.splitBy > 1 ? ` · shared, your part ${round(amount / b.splitBy).toFixed(2)}` : "";
    billLines.push({
      key: `bill:${b.id}`,
      label: b.name,
      amount,
      date,
      note:
        date < seenThrough
          ? "Usually charged by now, not in your data yet"
          : date < windowStart
            ? `Due before the 16th, not charged yet${shared}`
            : `${b.frequency}${shared}`,
    });
  }
  billLines.sort((a, b) => a.date!.localeCompare(b.date!));

  // What each card still owes: its posted balance (cards are paid as charges post, so the
  // whole history nets to what's unpaid) plus spending that hasn't posted or been downloaded
  const cardLines: PlanLine[] = [];
  const since = addDays(prepDay, -90);
  for (const card of cards) {
    const rows = all.filter((t) => t.accountId === card.id);
    if (!rows.length) continue;
    const owed = round(Math.max(0, -rows.reduce((s, t) => s + t.amount, 0)));
    const lags = rows.filter((t) => t.postedDate && t.date >= since).map((t) => days(t.postedDate!) - days(t.date));
    const lag = lags.length ? Math.max(1, Math.round(median(lags))) : 2;
    const lastData = rows.reduce((max, t) => (t.date > max ? t.date : max), "");
    // Spending from the last download through the 15th, plus what posts a few days late
    const gap = Math.min(15, Math.max(0, days(prepDay) - days(lastData)));
    const unposted = lag + gap;
    const everyday = rows
      .filter((t) => t.date >= since && t.date <= prepDay && isCost(t) && !billChargeIds.has(t.id) && t.category !== REIMBURSED)
      .reduce((s, t) => s - t.amount, 0);
    const daily = everyday / 90;
    const estimate = Math.round((daily * unposted) / 5) * 5;
    const amount = round(owed + estimate);
    if (amount <= 0) continue;
    const parts = [
      owed > 0 ? `${owed.toFixed(2)} posted, not paid` : "Nothing posted unpaid",
      estimate > 0 ? `~${estimate} for ${unposted} day${unposted === 1 ? "" : "s"} not in your data by ${monthDay(prepDay)}` : "",
    ].filter(Boolean);
    cardLines.push({ key: `pending-card:${card.id}`, label: card.name, amount, note: parts.join(" · ") });
  }

  // Accounts whose downloads stop well short of today
  const stale = accounts
    .map((a) => ({ name: a.name, through: all.filter((t) => t.accountId === a.id).reduce((m, t) => (t.date > m ? t.date : m), "") }))
    .filter((a) => a.through && days(a.through) >= days(seenThrough) - 60 && days(a.through) < days(seenThrough) - 2)
    .sort((a, b) => a.through.localeCompare(b.through));

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
    const recentMonths = new Set(rows.filter((t) => days(t.date) >= days(prepDay) - 125).map((t) => t.month));
    const name = last.merchant;
    if (rows.some((t) => t.month === month && t.date >= windowStart)) continue;
    if (recentMonths.size >= 3) {
      const day = Math.round(median(rows.slice(-6).map((t) => Number(t.date.slice(8, 10)))));
      if (dateIn(month, day) >= windowStart) workLines.push({ key: `work:${name}`, label: name, amount: round(-last.amount), date: dateIn(month, day), note: "Monthly" });
    } else {
      const lastYear = rows.filter((t) => t.month === yearAgo && t.date.slice(8, 10) >= windowStart.slice(8, 10));
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
    payday: payday ? { date: payday.date, amount: round(payday.amount) } : null,
    /** Accounts whose data stops more than a couple of days before the plan date */
    stale,
    bills: billLines,
    cards: cardLines,
    work: workLines,
  };
}
