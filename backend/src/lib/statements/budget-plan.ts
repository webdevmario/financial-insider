/**
 * The budget plan: what's really free to spend in one half of a month.
 *
 * Usually the second half (the 16th to month-end), prepped on the 15th once the mid-month
 * paycheck has landed; the first half (the 1st to the 15th, prepped on the last day of the
 * month before) works the same way. You enter the checking balance and set aside:
 * - bills that haven't charged yet and are due by the end of the half (projected amounts, by
 *   their usual day). A bill whose charge already shows up is out of checking, even if early
 *   Bills billed per visit (several charges a month) get what usually charges in that half,
 *   less what has charged in it already
 * - what each card still owes: posted charges not paid yet (exact, from the card's activity,
 *   since cards are paid as charges post) plus an estimate for spending not in the data yet
 * - card payments already made on the card side that haven't come out of checking yet
 * - savings and anything else held back (asked for in the conversation, not computed here)
 * Work expenses come back with the month-end paycheck. Those due in the half are listed but
 * left out (not ones whose linked bill is paused or cancelled); in the second half, those
 * charged in the first half are added back.
 *
 * This module only suggests lines from the data; the /budget skill reviews them with the user.
 */
import { db } from "../../db/index.js";
import { payees, statementAccounts, subscriptions, transactions, type Subscription, type Transaction } from "../../db/schema.js";
import { isActiveBill } from "../bills.js";
import { today } from "../date.js";
import { billCharges, isCost } from "./bill-match.js";
import { computeBillProjections, projectedAmount } from "./projection.js";

const REIMBURSED = "Work (Reimbursed)";
const STEP_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };
/** A charge this big from a payee seen only once or twice in 90 days is a one-off, not everyday spending */
const ONE_OFF_MIN = 250;
/** How far back a card payment with no checking side counts as still on its way */
const IN_TRANSIT_DAYS = 10;

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

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

const inHalf = (date: string, half: Half) => (half === "first" ? date.slice(8, 10) <= "15" : date.slice(8, 10) >= "16");

/**
 * A bill billed per visit: two or more charges in at least half of the last six months.
 * Returns what usually charges in this half and on which day, or null for an ordinary bill.
 */
function perVisitHalf(charges: Transaction[], month: string, half: Half) {
  const months = Array.from({ length: 6 }, (_, i) => addMonths(month, -6 + i));
  const counts = months.map((m) => charges.filter((t) => t.month === m).length);
  if (counts.filter((n) => n >= 2).length < 3) return null;
  const inPast = charges.filter((t) => months.includes(t.month) && inHalf(t.date, half));
  const totals = months.map((m) => inPast.filter((t) => t.month === m).reduce((s, t) => s - t.amount, 0));
  return {
    usual: round(median(totals)),
    low: round(Math.min(...totals)),
    high: round(Math.max(...totals)),
    day: inPast.length ? Math.round(median(inPast.map((t) => Number(t.date.slice(8, 10))))) : half === "first" ? 15 : 28,
  };
}

export interface PlanLine {
  key: string;
  label: string;
  amount: number;
  /** Plain words on where the number comes from */
  note: string;
  date?: string;
}

export type Half = "first" | "second";

export function computeBudgetPlan(month = today().slice(0, 7), half: Half = "second") {
  const all = db.select().from(transactions).all();
  const allBills = db.select().from(subscriptions).all();
  const bills = allBills.filter(isActiveBill);
  const payeeList = db.select().from(payees).all();
  const accounts = db.select().from(statementAccounts).all();
  const cards = accounts.filter((a) => a.kind === "credit");
  const projections = computeBillProjections(month);
  const now = today();
  const windowStart = half === "first" ? `${month}-01` : `${month}-16`;
  const windowEnd = half === "first" ? `${month}-15` : dateIn(month, 31);
  // The day the balance is taken: the day before the half starts, or today when prepping late
  const prepBase = addDays(windowStart, -1);
  const prepDay = now > prepBase && now <= windowEnd ? now : prepBase;
  // "Usually charged by now" is judged against today, unless the half is already over
  const seenThrough = now <= windowEnd ? now : prepDay;

  // The paycheck that funds this half, which often lands a few days before it starts
  const payday =
    all
      .filter((t) => t.kind === "income" && t.category === "Paycheck" && t.amount > 0)
      .filter((t) => t.date >= addDays(prepBase, -7) && t.date <= addDays(prepBase, 1))
      .sort((a, b) => a.date.localeCompare(b.date))
      .pop() ?? null;

  const billLines: PlanLine[] = [];
  const billChargeIds = new Set<string>();

  for (const b of bills) {
    const { charges } = billCharges(b, all, payeeList);
    for (const t of charges) billChargeIds.add(t.id);
    const visits = b.frequency === "monthly" ? perVisitHalf(charges, month, half) : null;
    if (visits) {
      const charged = round(charges.filter((t) => t.date >= windowStart && t.date <= windowEnd).reduce((s, t) => s - t.amount, 0));
      const amount = round(visits.usual - charged);
      if (amount <= 0) continue;
      const range = visits.low === visits.high ? "" : ` (last 6 months ${visits.low.toFixed(2)} to ${visits.high.toFixed(2)})`;
      billLines.push({
        key: `bill:${b.id}`,
        label: b.name,
        amount,
        date: dateIn(month, visits.day),
        note: `Billed per visit · usually ${visits.usual.toFixed(2)} this half${range}${charged > 0 ? `, ${charged.toFixed(2)} charged so far` : ""}`,
      });
      continue;
    }
    const day = chargeDayIn(b, month, charges);
    if (day == null) continue;
    const date = dateIn(month, day);
    if (date > windowEnd) continue;
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
            ? `Due before ${monthDay(windowStart)}, not charged yet${shared}`
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
    const recent = rows.filter((t) => t.date >= since && t.date <= prepDay && isCost(t) && !billChargeIds.has(t.id) && t.category !== REIMBURSED);
    const seen = new Map<string, number>();
    for (const t of recent) {
      const k = t.payeeId ?? t.merchant;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    const oneOff = (t: Transaction) => -t.amount >= ONE_OFF_MIN && (seen.get(t.payeeId ?? t.merchant) ?? 0) <= 2;
    const skipped = round(recent.filter(oneOff).reduce((s, t) => s - t.amount, 0));
    const everyday = recent.filter((t) => !oneOff(t)).reduce((s, t) => s - t.amount, 0);
    const daily = everyday / 90;
    const estimate = Math.round((daily * unposted) / 5) * 5;
    const amount = round(owed + estimate);
    if (amount <= 0) continue;
    const parts = [
      owed > 0 ? `${owed.toFixed(2)} posted, not paid` : "Nothing posted unpaid",
      estimate > 0 ? `~${estimate} for ${unposted} day${unposted === 1 ? "" : "s"} not in your data by ${monthDay(prepDay)}` : "",
      skipped > 0 ? `leaves out ${skipped.toFixed(2)} in one-off charges` : "",
    ].filter(Boolean);
    cardLines.push({ key: `pending-card:${card.id}`, label: card.name, amount, note: parts.join(" · ") });
  }

  // Card payments the card already shows but checking doesn't yet: transfers pair once both
  // sides are in the data, so a recent unpaired one is still on its way out of checking
  const inTransitLines: PlanLine[] = all
    .filter(
      (t) =>
        cards.some((c) => c.id === t.accountId) &&
        t.kind === "transfer" &&
        t.amount > 0 &&
        !t.transferPeerId &&
        t.date >= addDays(prepDay, -IN_TRANSIT_DAYS) &&
        t.date <= prepDay
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({
      key: `in-transit:${t.id}`,
      label: `${cards.find((c) => c.id === t.accountId)!.name} payment`,
      amount: round(t.amount),
      date: t.date,
      note: `Paid ${monthDay(t.date)}, not out of checking in your data yet`,
    }));

  // Accounts whose downloads stop well short of today
  const stale = accounts
    .map((a) => ({ name: a.name, through: all.filter((t) => t.accountId === a.id).reduce((m, t) => (t.date > m ? t.date : m), "") }))
    .filter((a) => a.through && days(a.through) >= days(seenThrough) - 60 && days(a.through) < days(seenThrough) - 2)
    .sort((a, b) => a.through.localeCompare(b.through));

  // Second half: work expenses charged in the first half come back with the month-end paycheck,
  // inside this half, after already leaving checking
  const reimbursementLines: PlanLine[] =
    half === "second"
      ? all
          .filter((t) => t.category === REIMBURSED && isCost(t) && t.date >= `${month}-01` && t.date < windowStart)
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((t) => ({
            key: `reimbursed:${t.id}`,
            label: t.merchant,
            amount: round(-t.amount),
            date: t.date,
            note: `Charged ${monthDay(t.date)}, comes back with the month-end paycheck`,
          }))
      : [];

  // Work expenses expected in the window: listed but left out by default (in the second half
  // they come back with the month-end paycheck; in the first half, after it ends)
  const workLines: PlanLine[] = [];
  // A work expense linked to a paused or cancelled bill has stopped: don't expect it again
  const stoppedBillIds = new Set(allBills.filter((b) => !isActiveBill(b)).map((b) => b.id));
  const stoppedPayeeIds = new Set(payeeList.filter((p) => p.billId && stoppedBillIds.has(p.billId)).map((p) => p.id));
  const yearAgo = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
  const byPayee = new Map<string, Transaction[]>();
  for (const t of all) {
    if (t.category !== REIMBURSED || !isCost(t)) continue;
    if (t.payeeId && stoppedPayeeIds.has(t.payeeId)) continue;
    const k = t.payeeId ?? t.merchant;
    (byPayee.get(k) ?? byPayee.set(k, []).get(k)!).push(t);
  }
  for (const rows of byPayee.values()) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const last = rows[rows.length - 1];
    const recentMonths = new Set(rows.filter((t) => days(t.date) >= days(prepDay) - 125).map((t) => t.month));
    const name = last.merchant;
    if (rows.some((t) => t.date >= windowStart && t.date <= windowEnd)) continue;
    if (recentMonths.size >= 3) {
      const day = Math.round(median(rows.slice(-6).map((t) => Number(t.date.slice(8, 10)))));
      const date = dateIn(month, day);
      if (date >= windowStart && date <= windowEnd) workLines.push({ key: `work:${name}`, label: name, amount: round(-last.amount), date: dateIn(month, day), note: "Monthly" });
    } else {
      const lastYear = rows.filter((t) => t.month === yearAgo && t.date.slice(8, 10) >= windowStart.slice(8, 10) && t.date.slice(8, 10) <= windowEnd.slice(8, 10));
      if (lastYear.length) {
        const t = lastYear[lastYear.length - 1];
        workLines.push({ key: `work:${name}`, label: name, amount: round(-t.amount), date: dateIn(month, Number(t.date.slice(8, 10))), note: "Charged this month last year" });
      }
    }
  }
  workLines.sort((a, b) => a.date!.localeCompare(b.date!));

  return {
    month,
    half,
    window: { start: windowStart, end: windowEnd },
    prepDay,
    payday: payday ? { date: payday.date, amount: round(payday.amount) } : null,
    /** Accounts whose data stops more than a couple of days before the plan date */
    stale,
    bills: billLines,
    cards: cardLines,
    /** Card payments made but not yet out of checking: subtract unless the balance already shows them */
    inTransit: inTransitLines,
    /** Work expenses already paid that come back inside the half: added to what's free */
    reimbursements: reimbursementLines,
    work: workLines,
  };
}
