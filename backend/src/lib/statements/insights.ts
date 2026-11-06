/**
 * What the imported transactions say: monthly totals, recurring charges (and
 * their price changes, late or stopped ones), bills vs what was actually charged,
 * possible duplicates, fees and interest, paychecks, and card payments.
 *
 * Amounts in the output are positive costs unless the field says otherwise.
 */
import { db } from "../../db/index.js";
import { settings, statementAccounts, subscriptions, transactions, type Transaction } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { today } from "../date.js";
import { merchantKey } from "./merchant.js";

const round = (n: number) => Math.round(n * 100) / 100;

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * 86_400_000).toISOString().slice(0, 10);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const isCost = (t: Transaction) => t.amount < 0 && (t.kind === "spend" || t.kind === "fee" || t.kind === "interest");

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

// ── Recurring charges ─────────────────────────────────────────────

type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
const CADENCES: { id: Cadence; min: number; max: number; perYear: number; minCount: number }[] = [
  { id: "weekly", min: 6, max: 8, perYear: 52, minCount: 4 },
  { id: "biweekly", min: 13, max: 16, perYear: 26, minCount: 4 },
  { id: "monthly", min: 26, max: 35, perYear: 12, minCount: 3 },
  { id: "quarterly", min: 84, max: 97, perYear: 4, minCount: 2 },
  { id: "annual", min: 355, max: 376, perYear: 1, minCount: 2 },
];

/** Words too generic to match a bill name against a merchant */
const GENERIC = new Set(["bill", "bills", "insurance", "payment", "monthly", "annual", "service", "services", "plan", "home", "auto", "the", "and", "card", "online"]);

function billTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !GENERIC.has(w));
}

function matchesBill(key: string, tokens: string[]) {
  return tokens.some((w) => key.includes(w));
}

export function computeInsights(month?: string) {
  const all = db.select().from(transactions).all();
  const accounts = db.select().from(statementAccounts).all();
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const bills = db.select().from(subscriptions).all();
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
    const k = merchantKey(t.merchant);
    const m = byMerchant.get(k) ?? { merchant: t.merchant, amount: 0, count: 0 };
    m.amount -= t.amount;
    m.count++;
    byMerchant.set(k, m);
    const a = byAccount.get(t.accountId) ?? { accountId: t.accountId, name: accountName.get(t.accountId) || t.accountId, spent: 0, count: 0 };
    a.spent -= t.amount;
    a.count++;
    byAccount.set(t.accountId, a);
  }

  // Recurring: group costs by merchant, look for a steady rhythm
  const groups = new Map<string, Transaction[]>();
  for (const t of all) {
    if (!isCost(t)) continue;
    const k = merchantKey(t.merchant);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
  }

  const recurring = [];
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const gaps = rows.slice(1).map((t, i) => dayNumber(t.date) - dayNumber(rows[i].date)).filter((g) => g > 2);
    if (!gaps.length) continue;
    const gap = median(gaps);
    const cadence = CADENCES.find((c) => gap >= c.min && gap <= c.max);
    if (!cadence) continue;
    // Mostly on rhythm (not a store you happen to visit about that often)
    const onRhythm = gaps.filter((g) => g >= cadence.min - 3 && g <= cadence.max + 3).length / gaps.length;
    if (onRhythm < 0.6) continue;

    const amounts = rows.map((t) => -t.amount);
    const recent = amounts.slice(-6);
    const avg = recent.reduce((s, n) => s + n, 0) / recent.length;
    const sd = Math.sqrt(recent.reduce((s, n) => s + (n - avg) ** 2, 0) / recent.length);
    const cv = avg ? sd / avg : 0;

    // A price step (15.49 → 17.99) is one change; a utility bill changes nearly every time
    const stepAt = (i: number) => Math.abs(amounts[i] - amounts[i - 1]) >= Math.max(0.5, amounts[i - 1] * 0.01);
    const recentSteps = amounts.slice(-6).filter((_, i, arr) => i > 0 && stepAt(amounts.length - arr.length + i)).length;
    const variable = recentSteps >= 3;
    // Amounts all over the place: a store you shop at regularly, not a bill
    if (variable && (cv > 0.35 || cadence.id === "weekly" || cadence.id === "biweekly")) continue;

    const last = rows[rows.length - 1];
    const daysSince = dayNumber(latestData) - dayNumber(last.date);
    const isNew = rows.length < cadence.minCount;
    // Two monthly charges is only "new" if it's recent; otherwise it's noise
    if (isNew && (cadence.id !== "monthly" || rows.length !== 2 || daysSince > 45)) continue;

    const lastAmount = -last.amount;
    const prevAmount = -rows[rows.length - 2].amount;
    // Most recent price change, if it happened in the last 6 months
    let change = 0;
    let changeDate: string | null = null;
    if (!variable) {
      for (let i = amounts.length - 1; i > 0; i--) {
        if (stepAt(i)) {
          if (dayNumber(latestData) - dayNumber(rows[i].date) <= 183) {
            change = round(amounts[i] - amounts[i - 1]);
            changeDate = rows[i].date;
          }
          break;
        }
      }
    }
    const priceChanged = changeDate !== null;

    const slack = Math.max(7, gap * 0.25);
    const status =
      daysSince > gap * 2 + slack ? "stopped"
      : daysSince > gap + slack ? "late"
      : isNew ? "new"
      : "active";

    const bill = bills.find((b) => matchesBill(key, billTokens(b.name)));
    recurring.push({
      key,
      merchant: last.merchant,
      category: last.category,
      accounts: [...new Set(rows.map((t) => accountName.get(t.accountId) || t.accountId))],
      cadence: cadence.id,
      count: rows.length,
      firstDate: rows[0].date,
      lastDate: last.date,
      nextExpected: addDays(last.date, Math.round(gap)),
      lastAmount: round(lastAmount),
      prevAmount: round(prevAmount),
      avgAmount: round(avg),
      minAmount: round(Math.min(...recent)),
      maxAmount: round(Math.max(...recent)),
      change,
      changeDate,
      variable,
      priceChanged,
      yearlyCost: round(avg * cadence.perYear),
      status,
      billId: bill?.id ?? null,
      billName: bill?.name ?? null,
      history: rows.slice(-12).map((t) => ({ date: t.date, amount: round(-t.amount) })),
    });
  }
  recurring.sort((a, b) => b.yearlyCost - a.yearlyCost);

  // Bills list vs actual charges
  const billsVsActual = bills.map((b) => {
    const tokens = billTokens(b.name);
    const charges = tokens.length
      ? all.filter((t) => isCost(t) && matchesBill(merchantKey(t.merchant), tokens)).sort((x, y) => x.date.localeCompare(y.date))
      : [];
    const last = charges[charges.length - 1];
    const recentAmounts = charges.slice(-6).map((t) => -t.amount);
    const window = b.frequency === "annual" ? 380 : b.frequency === "quarterly" ? 100 : 40;
    return {
      id: b.id,
      name: b.name,
      frequency: b.frequency,
      listedAmount: b.amount,
      matched: charges.length,
      lastDate: last?.date ?? null,
      lastAmount: last ? round(-last.amount) : null,
      avgAmount: recentAmounts.length ? round(recentAmounts.reduce((s, n) => s + n, 0) / recentAmounts.length) : null,
      diff: last ? round(-last.amount - b.amount) : null,
      notSeenRecently: !last || dayNumber(latestData) - dayNumber(last.date) > window,
    };
  });

  // Possible duplicate charges: same account, merchant and amount within 3 days
  const recentCutoff = addDays(latestData, -120);
  const dupCandidates = all
    .filter((t) => isCost(t) && t.date >= recentCutoff && -t.amount >= 10)
    .sort((a, b) => a.date.localeCompare(b.date));
  const duplicates: { a: Transaction; b: Transaction }[] = [];
  for (let i = 0; i < dupCandidates.length; i++) {
    for (let j = i + 1; j < dupCandidates.length; j++) {
      const a = dupCandidates[i], b = dupCandidates[j];
      if (dayNumber(b.date) - dayNumber(a.date) > 3) break;
      if (a.accountId === b.accountId && a.amount === b.amount && merchantKey(a.merchant) === merchantKey(b.merchant)) {
        duplicates.push({ a, b });
      }
    }
  }

  // Fees and interest, newest first
  const feesAndInterest = all
    .filter((t) => (t.kind === "fee" || t.kind === "interest") && t.amount < 0)
    .sort((a, b) => b.date.localeCompare(a.date));

  // Paychecks
  const paychecks = all
    .filter((t) => t.kind === "income" && t.category === "Paycheck")
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => ({ id: t.id, date: t.date, amount: t.amount, description: t.description, accountId: t.accountId }));

  // Card payments: when each card was paid, and from where
  const byId = new Map(all.map((t) => [t.id, t]));
  const cardPayments = accounts
    .filter((a) => a.kind === "credit")
    .map((a) => {
      const pays = all
        .filter((t) => t.accountId === a.id && t.kind === "transfer" && t.amount > 0)
        .sort((x, y) => y.date.localeCompare(x.date));
      const sources = new Map<string, { name: string; count: number; total: number }>();
      for (const p of pays) {
        const from = p.transferPeerId ? byId.get(p.transferPeerId)?.accountId ?? null : null;
        const name = from ? accountName.get(from) || from : "Not in imported accounts";
        const s = sources.get(name) ?? { name, count: 0, total: 0 };
        s.count++;
        s.total = round(s.total + p.amount);
        sources.set(name, s);
      }
      return {
        accountId: a.id,
        name: a.name,
        count: pays.length,
        total: round(pays.reduce((s, p) => s + p.amount, 0)),
        lastDate: pays[0]?.date ?? null,
        sources: [...sources.values()].sort((x, y) => y.total - x.total),
        recent: pays.slice(0, 8).map((p) => ({
          date: p.date,
          amount: p.amount,
          from: p.transferPeerId ? accountName.get(byId.get(p.transferPeerId)?.accountId ?? "") ?? null : null,
        })),
      };
    })
    .filter((c) => c.count);

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
    recurring,
    billsVsActual,
    duplicates: duplicates.reverse(),
    feesAndInterest,
    feesAndInterestTotal: round(feesAndInterest.reduce((s, t) => s - t.amount, 0)),
    paychecks,
    expectedPaycheck,
    cardPayments,
  };
}
