/**
 * What the imported transactions say: monthly totals, bills vs what was
 * actually charged, and paychecks.
 *
 * Amounts in the output are positive costs unless the field says otherwise.
 */
import { db } from "../../db/index.js";
import { payees, settings, statementAccounts, subscriptions, transactions, type Transaction } from "../../db/schema.js";
import { billState } from "../bills.js";
import { eq } from "drizzle-orm";
import { today } from "../date.js";
import { groupKey } from "./payees.js";
import { billCharges, isCost } from "./bill-match.js";

const round = (n: number) => Math.round(n * 100) / 100;

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}


// ── Monthly summary ───────────────────────────────────────────────

function summarize(rows: Transaction[]) {
  let spent = 0, refunds = 0, income = 0, fees = 0, interest = 0, transfers = 0;
  for (const t of rows) {
    if (t.kind === "transfer") transfers++;
    else if (isCost(t)) {
      spent += -t.amount;
      if (t.kind === "fee") fees += -t.amount;
      if (t.kind === "interest") interest += -t.amount;
    } else if (t.kind === "refund" || (t.kind === "spend" && t.amount > 0)) refunds += t.amount;
    else if (t.amount > 0) income += t.amount;
  }
  return {
    spent: round(spent),
    refunds: round(refunds),
    netSpent: round(spent - refunds),
    income: round(income),
    net: round(income - spent + refunds),
    fees: round(fees),
    interest: round(interest),
    transfersExcluded: transfers,
    count: rows.length,
  };
}

export function computeInsights(month?: string) {
  const all = db.select().from(transactions).all();
  const accounts = db.select().from(statementAccounts).all();
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const bills = db.select().from(subscriptions).all();
  const payeeList = db.select().from(payees).all();
  const payeeById = new Map(payeeList.map((p) => [p.id, p]));
  const paycheckSetting = db.select().from(settings).where(eq(settings.key, "paycheck")).get();
  const expectedPaycheck = paycheckSetting ? Number(JSON.parse(paycheckSetting.value)) || 0 : 0;

  const months = [...new Set(all.map((t) => t.month))].sort().reverse();
  const selected = month && months.includes(month) ? month : months[0] ?? today().slice(0, 7);
  const prevMonth = months.find((m) => m < selected) ?? null;
  // Staleness is measured from the newest transaction, so an older export doesn't flag everything as late
  const latestData = all.reduce((max, t) => (t.date > max ? t.date : max), "") || today();

  const inMonth = all.filter((t) => t.month === selected);

  // Category / merchant / account breakdowns for the month
  const byCategory = new Map<string, number>();
  const byMerchant = new Map<string, { merchant: string; amount: number; count: number }>();
  const byAccount = new Map<string, { accountId: string; name: string; spent: number; count: number }>();
  for (const t of inMonth) {
    if (!isCost(t)) continue;
    byCategory.set(t.category, (byCategory.get(t.category) || 0) - t.amount);
    const k = groupKey(t);
    const m = byMerchant.get(k) ?? { merchant: t.merchant, amount: 0, count: 0 };
    m.amount -= t.amount;
    m.count++;
    byMerchant.set(k, m);
    const a = byAccount.get(t.accountId) ?? { accountId: t.accountId, name: accountName.get(t.accountId) || t.accountId, spent: 0, count: 0 };
    a.spent -= t.amount;
    a.count++;
    byAccount.set(t.accountId, a);
  }

  // Bills list vs actual charges
  const billsVsActual = bills.map((b) => {
    const { charges, linked } = billCharges(b, all, payeeList);
    const last = charges[charges.length - 1];
    const recentAmounts = charges.slice(-6).map((t) => -t.amount);
    const window = b.frequency === "annual" ? 380 : b.frequency === "quarterly" ? 100 : 40;
    const state = billState(b);
    return {
      id: b.id,
      name: b.name,
      frequency: b.frequency,
      listedAmount: b.amount,
      linkedPayee: linked.size ? payeeById.get([...linked][0])?.name ?? null : null,
      matched: charges.length,
      lastDate: last?.date ?? null,
      lastAmount: last ? round(-last.amount) : null,
      avgAmount: recentAmounts.length ? round(recentAmounts.reduce((s, n) => s + n, 0) / recentAmounts.length) : null,
      diff: last ? round(-last.amount - b.amount) : null,
      state,
      stateSince: b.stateSince ?? null,
      // Paused and cancelled bills aren't expected, so silence is fine; a charge after stopping is not
      notSeenRecently: state === "active" && (!last || dayNumber(latestData) - dayNumber(last.date) > window),
      chargedSinceStopped: state !== "active" && b.stateSince ? charges.filter((t) => t.date > b.stateSince!).length : 0,
    };
  });

  // Paychecks
  const paychecks = all
    .filter((t) => t.kind === "income" && t.category === "Paycheck")
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => ({ id: t.id, date: t.date, amount: t.amount, description: t.description, accountId: t.accountId }));

  return {
    months,
    month: selected,
    prevMonth,
    asOf: latestData,
    summary: summarize(inMonth),
    // The newest month is usually still in progress: compare it with the same point last month
    partial: selected === months[0] && latestData.slice(0, 7) === selected,
    prevSummary: prevMonth
      ? summarize(
          all.filter(
            (t) => t.month === prevMonth && (selected !== months[0] || t.date.slice(8) <= latestData.slice(8))
          )
        )
      : null,
    byCategory: [...byCategory].map(([category, amount]) => ({ category, amount: round(amount) })).sort((a, b) => b.amount - a.amount),
    topMerchants: [...byMerchant.values()].map((m) => ({ ...m, amount: round(m.amount) })).sort((a, b) => b.amount - a.amount).slice(0, 12),
    byAccount: [...byAccount.values()].map((a) => ({ ...a, spent: round(a.spent) })).sort((a, b) => b.spent - a.spent),
    billsVsActual,
    paychecks,
    expectedPaycheck,
  };
}
