/**
 * What costs more: the past 12 full months against the 12 before them, in three plain views.
 *
 * - Food: groceries and eating out side by side, per month, with how often. Bank data has no
 *   receipts, so this can't split price from quantity; showing both together answers "are we
 *   paying more for food, or just eating at home more?"
 * - Same place, new price: the average spent per visit at places you go often (groceries,
 *   dining, haircuts). Same store, similar trips, so a change is mostly price. Gas is left out:
 *   a fill-up depends on how empty the tank was.
 * - Bills: each bill's latest charge against its charge about a year earlier. Same service,
 *   so a change is a price change, except for bills that swing with usage (flagged). Donations
 *   are left out: they're chosen, not priced.
 * Only increases are listed; the card is about what costs more.
 */
import { db } from "../../db/index.js";
import { payees, subscriptions, transactions, type Transaction } from "../../db/schema.js";
import { isActiveBill } from "../bills.js";
import { today } from "../date.js";
import { billCharges, isCost } from "./bill-match.js";

const PLACE_CATEGORIES = new Set(["Grocery", "Dining", "Food & Drink", "Personal Care"]);
const NOT_PRICED = new Set(["Donations", "Savings"]);
/** Power, gas and water bills move with usage as well as price */
const USAGE = /electric|energy|power|\bgas\b|water|sewage|utilit|\bPEC\b/i;
/** Visits needed in each year before a place's average means anything */
const MIN_VISITS = 8;
/** Smaller moves are noise */
const MIN_CHANGE = 0.05;

const round = (n: number) => Math.round(n * 100) / 100;
const days = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const monthStart = (month: string, back: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return d.toISOString().slice(0, 7);
};

export interface Change {
  name: string;
  before: number;
  now: number;
  /** now / before - 1 */
  pct: number;
  /** "a trip", "a visit", "a month"… */
  per: string;
  /** Bills: how much more a month this adds */
  monthly?: number;
  detail?: string;
}

export function computeCostChanges() {
  const all = db.select().from(transactions).all();
  const payeeList = db.select().from(payees).all();
  // The past 12 full months, and the 12 before them
  const thisMonth = today().slice(0, 7);
  const recent = { from: monthStart(thisMonth, 12), to: monthStart(thisMonth, 1) };
  const prior = { from: monthStart(thisMonth, 24), to: monthStart(thisMonth, 13) };
  const inRange = (t: Transaction, r: { from: string; to: string }) => t.month >= r.from && t.month <= r.to;
  const costs = all.filter((t) => isCost(t) && t.category !== "Work (Reimbursed)");

  // ── Food ──
  const food = (category: string) => {
    const side = (r: typeof recent) => {
      const rows = costs.filter((t) => t.category === category && inRange(t, r));
      return { perMonth: round(rows.reduce((s, t) => s - t.amount, 0) / 12), timesPerMonth: Math.round(rows.length / 12) };
    };
    return { before: side(prior), now: side(recent) };
  };
  const groceries = food("Grocery");
  const dining = food("Dining");
  const hasPrior = groceries.before.perMonth + dining.before.perMonth > 0;

  // ── Same place, new price ──
  const billIds = new Set<string>();
  const bills = db.select().from(subscriptions).all().filter(isActiveBill);
  const billChargeLists = bills.map((b) => ({ bill: b, charges: billCharges(b, all, payeeList).charges }));
  for (const { charges } of billChargeLists) for (const t of charges) billIds.add(t.id);

  const byPlace = new Map<string, Transaction[]>();
  for (const t of costs) {
    if (!PLACE_CATEGORIES.has(t.category) || billIds.has(t.id)) continue;
    if (!inRange(t, prior) && !inRange(t, recent)) continue;
    const k = t.payeeId ?? t.merchant;
    (byPlace.get(k) ?? byPlace.set(k, []).get(k)!).push(t);
  }
  const places: Change[] = [];
  for (const rows of byPlace.values()) {
    const a = rows.filter((t) => inRange(t, prior));
    const b = rows.filter((t) => inRange(t, recent));
    if (a.length < MIN_VISITS || b.length < MIN_VISITS) continue;
    const before = a.reduce((s, t) => s - t.amount, 0) / a.length;
    const now = b.reduce((s, t) => s - t.amount, 0) / b.length;
    const pct = now / before - 1;
    if (pct < MIN_CHANGE) continue;
    const category = b[b.length - 1].category;
    places.push({
      name: b[b.length - 1].merchant,
      before: round(before),
      now: round(now),
      pct: round(pct),
      per: category === "Grocery" ? "a trip" : "a visit",
      detail: `${b.length} visits this year`,
    });
  }
  places.sort((x, y) => y.pct - x.pct);

  // ── Bills ──
  const billChanges: Change[] = [];
  for (const { bill, charges } of billChargeLists) {
    if (!charges.length || NOT_PRICED.has(bill.category)) continue;
    const latest = charges[charges.length - 1];
    if (latest.month < recent.from) continue;
    // The charge closest to a year before the latest one
    const target = days(latest.date) - 365;
    const yearAgo = charges
      .filter((t) => Math.abs(days(t.date) - target) <= 45)
      .sort((x, y) => Math.abs(days(x.date) - target) - Math.abs(days(y.date) - target))[0];
    if (!yearAgo) continue;
    const before = -yearAgo.amount;
    const now = -latest.amount;
    // Charges far from the bill's amount are other purchases its name happened to match
    const plausible = (v: number) => v >= bill.amount * 0.5 && v <= bill.amount * 2;
    if (!plausible(before) || !plausible(now)) continue;
    const pct = now / before - 1;
    if (pct < MIN_CHANGE || now - before < 1) continue;
    billChanges.push({
      name: bill.name,
      before: round(before),
      now: round(now),
      pct: round(pct),
      per: bill.frequency === "annual" ? "a year" : bill.frequency === "quarterly" ? "a quarter" : "a month",
      monthly: round((now - before) / (bill.frequency === "annual" ? 12 : bill.frequency === "quarterly" ? 3 : 1)),
      detail: USAGE.test(bill.name) ? "Also depends on usage" : undefined,
    });
  }
  billChanges.sort((x, y) => y.monthly! - x.monthly!);

  return {
    /** First and last month of each 12-month stretch */
    recent,
    prior,
    food: hasPrior ? { groceries, dining } : null,
    places,
    bills: billChanges,
  };
}
