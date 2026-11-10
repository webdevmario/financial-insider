/**
 * What each credit card earned on its real spending, at the reward rates typed
 * in for it, and which stored card pays the most in each category.
 *
 * Spending follows the same cost rules as the bill checks (`isCost`), net of
 * refunds. Two kinds of rows stay out of the earning spend:
 *  - fees and interest cost money but never earn rewards, so they're totalled apart;
 *  - the "Rewards" category holds cash-back redemptions, statement credits and
 *    adjustments, not purchases, so those are totalled apart as reward credits.
 *
 * Numbers only: nothing here suggests opening, closing or switching cards.
 */
import { db } from "../../db/index.js";
import { creditCards, statementAccounts, transactions, type CreditCard, type Transaction } from "../../db/schema.js";
import { and, gte, inArray, lte } from "drizzle-orm";
import { today } from "../date.js";
import { isCost } from "./bill-match.js";

const REWARDS = "Rewards";
const OTHER = "*";

export type RewardUnit = "percent" | "points";
export type RewardRates = Record<string, number>;

const round = (n: number) => Math.round(n * 100) / 100;

export function parseRates(raw: string | null): RewardRates {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** The card's rate for a category: an exact (case-insensitive) match, else "*", else 0 */
export function rateFor(rates: RewardRates, category: string): number {
  const want = category.toLowerCase();
  for (const [k, v] of Object.entries(rates)) if (k.toLowerCase() === want) return v;
  return rates[OTHER] ?? 0;
}

/** Cents a point is worth; cash back is always 1 cent per "point" (one percent of a dollar) */
const centsPerUnit = (card: CreditCard) => (card.rewardUnit === "points" ? card.pointValue ?? 1 : 1);

/** Rewards on `spend` at `rate`: in the card's own unit (dollars or points) and in dollars */
function earn(card: CreditCard, rate: number, spend: number) {
  if (card.rewardUnit === "points") {
    const points = spend * rate;
    return { earned: Math.round(points), value: round((points * centsPerUnit(card)) / 100) };
  }
  const dollars = round((spend * rate) / 100);
  return { earned: dollars, value: dollars };
}

const isRefund = (t: Transaction) => t.kind === "refund" || (t.kind === "spend" && t.amount > 0);

/** The window: the 12 months up to and including today */
function window(months: number) {
  const to = today();
  const d = new Date(`${to}T12:00:00`);
  d.setMonth(d.getMonth() - months);
  d.setDate(d.getDate() + 1);
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from, to };
}

type CardTotals = {
  /** Net spending that earns rewards, by category */
  byCategory: Map<string, number>;
  feesAndInterest: number;
  rewardCredits: number;
  firstDate: string | null;
  lastDate: string | null;
};

function totalsFor(rows: Transaction[]): CardTotals {
  const t: CardTotals = { byCategory: new Map(), feesAndInterest: 0, rewardCredits: 0, firstDate: null, lastDate: null };
  for (const r of rows) {
    if (!t.firstDate || r.date < t.firstDate) t.firstDate = r.date;
    if (!t.lastDate || r.date > t.lastDate) t.lastDate = r.date;
    if (r.category === REWARDS) {
      t.rewardCredits += r.amount;
      continue;
    }
    if (isCost(r) && (r.kind === "fee" || r.kind === "interest")) {
      t.feesAndInterest -= r.amount;
      continue;
    }
    if ((isCost(r) && r.kind === "spend") || isRefund(r)) {
      t.byCategory.set(r.category, (t.byCategory.get(r.category) ?? 0) - r.amount);
    }
  }
  return t;
}

export function cardAnalysis(months = 12) {
  const { from, to } = window(months);
  const cards = db.select().from(creditCards).all();
  const accountNames = new Map(db.select().from(statementAccounts).all().map((a) => [a.id, a.name]));
  const linkedIds = [...new Set(cards.map((c) => c.statementAccountId).filter((id): id is string => !!id))];

  const rows = linkedIds.length
    ? db
        .select()
        .from(transactions)
        .where(and(inArray(transactions.accountId, linkedIds), gte(transactions.date, from), lte(transactions.date, to)))
        .all()
    : [];
  const rowsByAccount = new Map<string, Transaction[]>();
  for (const r of rows) {
    const list = rowsByAccount.get(r.accountId);
    if (list) list.push(r);
    else rowsByAccount.set(r.accountId, [r]);
  }

  // Combined spending on every linked card, by category, and what was actually earned on it
  const combined = new Map<string, { spend: number; value: number }>();

  const cardResults = cards.map((card) => {
    const rates = parseRates(card.rewardRates);
    const base = {
      id: card.id,
      name: card.name,
      issuer: card.issuer,
      inUse: !!card.inUse,
      rewardUnit: card.rewardUnit as RewardUnit,
      pointValue: card.pointValue,
      annualFee: card.annualFee,
      statementAccountId: card.statementAccountId,
      accountName: card.statementAccountId ? accountNames.get(card.statementAccountId) ?? card.statementAccountId : null,
    };
    if (!card.statementAccountId) return { ...base, linked: false as const };

    const totals = totalsFor(rowsByAccount.get(card.statementAccountId) ?? []);
    const categories = [...totals.byCategory.entries()]
      .map(([category, raw]) => {
        const spend = round(raw);
        const rate = rateFor(rates, category);
        const { earned, value } = earn(card, rate, spend);
        const c = combined.get(category) ?? { spend: 0, value: 0 };
        c.spend += spend;
        c.value += value;
        combined.set(category, c);
        return { category, spend, rate, earned, value };
      })
      .filter((c) => c.spend !== 0)
      .sort((a, b) => b.spend - a.spend);

    const spend = round(categories.reduce((s, c) => s + c.spend, 0));
    const earned = card.rewardUnit === "points"
      ? categories.reduce((s, c) => s + c.earned, 0)
      : round(categories.reduce((s, c) => s + c.earned, 0));
    const value = round(categories.reduce((s, c) => s + c.value, 0));
    return {
      ...base,
      linked: true as const,
      firstDate: totals.firstDate,
      lastDate: totals.lastDate,
      spend,
      earned,
      value,
      feesAndInterest: round(totals.feesAndInterest),
      rewardCredits: round(totals.rewardCredits),
      valueLessFee: round(value - card.annualFee),
      categories,
    };
  });

  // For each category: what every card still in use would have earned on the combined spending
  const candidates = cards.filter((c) => c.inUse);
  const byCategory = [...combined.entries()]
    .filter(([, c]) => round(c.spend) > 0)
    .map(([category, c]) => {
      const spend = round(c.spend);
      const options = candidates
        .map((card) => {
          const rate = rateFor(parseRates(card.rewardRates), category);
          return { cardId: card.id, name: card.name, rate, rewardUnit: card.rewardUnit as RewardUnit, ...earn(card, rate, spend) };
        })
        .sort((a, b) => b.value - a.value);
      const best = options[0] && options[0].value > 0 ? options[0] : null;
      return { category, spend, actualValue: round(c.value), best, options };
    })
    .sort((a, b) => b.spend - a.spend);

  return { from, to, months, cards: cardResults, byCategory };
}

/** Every category that has spending in the transactions, for the rate editor */
export function spendingCategories(): string[] {
  const rows = db
    .selectDistinct({ category: transactions.category })
    .from(transactions)
    .where(inArray(transactions.kind, ["spend", "refund"]))
    .all();
  return rows.map((r) => r.category).filter((c) => c !== REWARDS).sort((a, b) => a.localeCompare(b));
}
