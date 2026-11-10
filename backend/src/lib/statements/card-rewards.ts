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
 * Store rates ("@Payee") beat category rates, and a bonus rate can carry a
 * yearly cap: spending past it (scaled to the window) earns the "*" rate.
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

/**
 * The card's rate for a purchase: a store rate written "@Payee" (for bonus
 * merchants like a store card's own store) wins, then the category, then "*",
 * else 0. Matches ignore case.
 */
export function rateFor(rates: RewardRates, category: string, payee?: string): number {
  const key = rateKey(rates, category, payee);
  return key ? rates[key] : 0;
}

/** Which rate entry applies: the "@Payee" key, the category key, "*", or null */
function rateKey(rates: RewardRates, category: string, payee?: string): string | null {
  const keys = Object.keys(rates);
  if (payee) {
    const store = `@${payee}`.toLowerCase();
    const k = keys.find((x) => x.toLowerCase() === store);
    if (k) return k;
  }
  const want = category.toLowerCase();
  return keys.find((x) => x.toLowerCase() === want) ?? (OTHER in rates ? OTHER : null);
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

/** The rate actually earned on a category, in the card's unit: percent back, or points per dollar */
function blendedRate(card: CreditCard, earned: number, value: number, spend: number): number {
  return card.rewardUnit === "points" ? Math.round((earned / spend) * 10) / 10 : Math.round((value / spend) * 1000) / 10;
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
  /** Net spending that earns rewards, by category and then payee (store rates are per payee) */
  byCategory: Map<string, Map<string, number>>;
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
      const byPayee = t.byCategory.get(r.category) ?? t.byCategory.set(r.category, new Map()).get(r.category)!;
      byPayee.set(r.merchant, (byPayee.get(r.merchant) ?? 0) - r.amount);
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

  // Combined spending on every linked card, by category (and payee), and what was actually earned on it
  const combined = new Map<string, { spend: number; value: number; byPayee: Map<string, number> }>();

  /**
   * Rewards on one category's spending, payee by payee, so store rates apply.
   * `budget` tracks how much capped spending is left per rate key; one map per
   * card shares a cap across every category it covers.
   */
  const earnOn = (card: CreditCard, rates: RewardRates, category: string, byPayee: Map<string, number>, budget = new Map<string, number>()) => {
    const caps = parseRates(card.rewardCaps);
    let earned = 0;
    let value = 0;
    const add = (e: { earned: number; value: number }) => {
      earned += e.earned;
      value += e.value;
    };
    for (const [payee, raw] of byPayee) {
      const key = rateKey(rates, category, payee);
      const rate = key ? rates[key] : 0;
      const capKey = key && key !== OTHER ? Object.keys(caps).find((c) => c.toLowerCase() === key.toLowerCase()) : undefined;
      if (!capKey || raw <= 0) {
        add(earn(card, rate, raw));
        continue;
      }
      const left = budget.get(capKey) ?? (caps[capKey] * months) / 12;
      const inCap = Math.min(raw, Math.max(0, left));
      budget.set(capKey, left - inCap);
      add(earn(card, rate, inCap));
      add(earn(card, rates[OTHER] ?? 0, raw - inCap));
    }
    return { earned: card.rewardUnit === "points" ? Math.round(earned) : round(earned), value: round(value) };
  };

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
    const budget = new Map<string, number>();
    const categories = [...totals.byCategory.entries()]
      .map(([category, byPayee]) => {
        const spend = round([...byPayee.values()].reduce((s, v) => s + v, 0));
        const { earned, value } = earnOn(card, rates, category, byPayee, budget);
        // With store rates in play the category's rate is the blend actually earned
        const rate = spend > 0 ? blendedRate(card, earned, value, spend) : rateFor(rates, category);
        const c = combined.get(category) ?? { spend: 0, value: 0, byPayee: new Map() };
        c.spend += spend;
        c.value += value;
        for (const [payee, v] of byPayee) c.byPayee.set(payee, (c.byPayee.get(payee) ?? 0) + v);
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
          const r = parseRates(card.rewardRates);
          const e = earnOn(card, r, category, c.byPayee);
          const rate = spend > 0 ? blendedRate(card, e.earned, e.value, spend) : rateFor(r, category);
          return { cardId: card.id, name: card.name, rate, rewardUnit: card.rewardUnit as RewardUnit, ...e };
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
