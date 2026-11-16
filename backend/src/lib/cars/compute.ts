/**
 * What each car has cost: bank charges assigned to it, shared costs split by rules, documents paid
 * outside the imported accounts, depreciation and loan interest. Plus the gaps worth filling
 * (car charges with no receipt, receipts with no charge, car charges not assigned to any car) and
 * the household numbers an upgrade decision needs.
 *
 * Pure functions over rows already loaded (CarData), so the app (drizzle, lib/cars/costs.ts) and the
 * read-only MCP (node:sqlite, mcp/queries.ts) compute the same numbers. No database imports here.
 *
 * Money here is positive dollars spent; a refund on a car charge is a negative cost.
 */
import type { Vehicle, VehicleDocument, VehicleLink, VehicleRule } from "../../db/schema.js";

/** The transaction columns the car math needs */
export interface CarTxn {
  id: string;
  date: string;
  month: string;
  amount: number;
  merchant: string;
  category: string;
  kind: string;
  payeeId: string | null;
}

export interface CarAsset {
  id: string;
  type: string;
  balance: number;
  lastUpdated: string | null;
  institution: string | null;
  owner: string | null;
}

export interface CarGoal {
  name: string;
  targetAmount: number;
  savedAmount: number;
  deadline: string | null;
  priority: string;
  completedAt: string | null;
}

export interface CarData {
  cars: Vehicle[];
  links: VehicleLink[];
  rules: VehicleRule[];
  docs: VehicleDocument[];
  /** Every imported transaction */
  txns: CarTxn[];
  assets: CarAsset[];
  goals: CarGoal[];
  /** YYYY-MM-DD */
  today: string;
}

/** Running costs, plus money paid toward buying the car (purchase, loan), which is counted through the price instead */
export const COST_TYPES = ["repair", "maintenance", "tires", "insurance", "fuel", "registration", "parking", "other", "purchase", "loan"] as const;
export type CostType = (typeof COST_TYPES)[number];
const OWNERSHIP_ONLY: CostType[] = ["purchase", "loan"];

export const DOC_TYPES = ["purchase", "sale", "loan", "repair", "maintenance", "tires", "insurance", "registration", "inspection", "fuel", "parking", "other"] as const;

/** The cost a document's type stands for; a sale isn't a cost */
export function docCostType(docType: string | null): CostType | null {
  switch (docType) {
    case "repair": case "maintenance": case "tires": case "insurance": case "registration":
    case "fuel": case "parking": case "purchase": case "loan": case "other":
      return docType;
    case "inspection":
      return "registration";
    default:
      return null;
  }
}

/** Bank categories that are car spending; charges in them that no link or rule covers show as unassigned */
export const CAR_CATEGORIES = ["Auto", "Gas"];
const SPENDING_KINDS = ["spend", "refund", "fee"];
/** Car charges at least this big are expected to have a receipt or invoice */
const RECEIPT_WORTHY = 100;
/** Under this many miles, cost per mile is noise */
const MIN_MILES = 500;

export interface CostEntry {
  vehicleId: string;
  date: string;
  amount: number;
  costType: CostType;
  source: "charge" | "rule" | "document";
  description: string;
  transactionId?: string;
  documentId?: string;
  linkId?: string;
  ruleId?: string;
  /** Fraction of the charge this car carries */
  share?: number;
}

export interface OdometerReading {
  date: string;
  miles: number;
  source: string;
  documentId?: string;
}

const round = (n: number) => Math.round(n * 100) / 100;
const spent = (t: Pick<CarTxn, "amount">) => -t.amount;

function ownedOn(v: Vehicle, date: string): boolean {
  return (!v.purchaseDate || v.purchaseDate <= date) && (!v.soldDate || date <= v.soldDate);
}

function parseShares(raw: string | null): Record<string, number> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function ruleMatches(rule: VehicleRule, t: CarTxn): boolean {
  if (rule.dateFrom && t.date < rule.dateFrom) return false;
  if (rule.dateTo && t.date > rule.dateTo) return false;
  if (rule.matchType === "payee") return t.payeeId === rule.matchValue;
  if (rule.matchType === "category") return t.category === rule.matchValue;
  if (rule.matchType === "merchant") return t.merchant.toLowerCase() === rule.matchValue.toLowerCase();
  return false;
}

/** How a rule splits one charge across the cars owned that day: { vehicleId: fraction } */
function ruleSplit(rule: VehicleRule, date: string, cars: Vehicle[]): [string, number][] {
  const owned = cars.filter((v) => ownedOn(v, date));
  const shares = parseShares(rule.shares);
  const weights: [string, number][] = shares
    ? owned.filter((v) => (shares[v.id] ?? 0) > 0).map((v) => [v.id, shares[v.id]])
    : owned.map((v) => [v.id, 1]);
  const total = weights.reduce((s, [, w]) => s + w, 0);
  return total > 0 ? weights.map(([id, w]) => [id, w / total]) : [];
}

/** Every cost the data knows about, per car */
export function costEntries(data: CarData): { entries: CostEntry[]; covered: Set<string> } {
  const { cars, links, rules } = data;
  const entries: CostEntry[] = [];
  const covered = new Set<string>(); // Transactions some car carries
  const byId = new Map(data.txns.map((t) => [t.id, t]));

  for (const l of links) {
    const t = byId.get(l.transactionId);
    if (!t) continue;
    covered.add(t.id);
    entries.push({
      vehicleId: l.vehicleId, date: t.date, amount: round(spent(t) * l.share), costType: l.costType as CostType,
      source: "charge", description: t.merchant, transactionId: t.id, linkId: l.id, share: l.share,
    });
  }

  if (rules.length && cars.length) {
    for (const t of data.txns) {
      if (!SPENDING_KINDS.includes(t.kind)) continue;
      if (covered.has(t.id)) continue; // A charge assigned by hand wins over rules
      const rule = rules.find((r) => ruleMatches(r, t));
      if (!rule) continue;
      const split = ruleSplit(rule, t.date, cars);
      if (!split.length) continue;
      covered.add(t.id);
      for (const [vehicleId, share] of split) {
        entries.push({
          vehicleId, date: t.date, amount: round(spent(t) * share), costType: rule.costType as CostType,
          source: "rule", description: t.merchant, transactionId: t.id, ruleId: rule.id, share,
        });
      }
    }
  }

  for (const d of data.docs) {
    if (d.status !== "done" || !d.paidOutside) continue;
    const type = docCostType(d.docType);
    if (!d.vehicleId || !d.total || !d.date || !type || d.transactionId) continue;
    entries.push({
      vehicleId: d.vehicleId, date: d.date, amount: round(d.total), costType: type,
      source: "document", description: d.vendor || d.summary || d.fileName, documentId: d.id,
    });
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));
  return { entries, covered };
}

// ── Per-car summary ────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}

function addYears(date: string, years: number): string {
  const d = new Date(date + "T12:00:00");
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return Math.max(0, (by - ay) * 12 + (bm - am));
}

/** Interest paid so far on the car loan: typed value, else estimated from the amortization schedule */
export function loanInterest(v: Vehicle, asOf: string): { amount: number; estimated: boolean } | null {
  if (v.interestPaid != null) return { amount: v.interestPaid, estimated: false };
  if (!v.loanAmount || !v.loanRate || !v.loanMonths || !v.purchaseDate) return null;
  const r = v.loanRate / 100 / 12;
  const n = v.loanMonths;
  const payment = (v.loanAmount * r) / (1 - Math.pow(1 + r, -n));
  const end = v.soldDate && v.soldDate < asOf ? v.soldDate : asOf;
  const paid = Math.min(n, monthsBetween(v.purchaseDate, end));
  let balance = v.loanAmount;
  let interest = 0;
  for (let i = 0; i < paid; i++) {
    const due = balance * r;
    interest += due;
    balance -= payment - due;
  }
  return { amount: round(interest), estimated: true };
}

export interface VehicleSummary {
  vehicle: Vehicle;
  currentValue: number | null;
  currentValueDate: string | null;
  /** Where currentValue came from */
  valueSource: "asset" | "estimate" | "sale" | null;
  ownedYears: number | null;
  /** Running costs by type, all time */
  running: Record<string, number>;
  runningTotal: number;
  /** Purchase and loan payments seen in the bank data, for reference; counted through the price */
  paidTowardCar: number;
  depreciation: number | null;
  interest: { amount: number; estimated: boolean } | null;
  /** Running costs + depreciation + interest */
  ownershipCost: number;
  perYear: number | null;
  perMonth: number | null;
  byYear: { year: string; total: number; byType: Record<string, number> }[];
  /** Repairs, maintenance and tires: the last 12 months and the 12 before */
  upkeepLast12: number;
  upkeepPrior12: number;
  /** Running costs in the last 12 months */
  runningLast12: number;
  readings: OdometerReading[];
  latestMiles: number | null;
  milesPerYear: number | null;
  estimatedMilesNow: number | null;
  milesDriven: number | null;
  costPerMile: number | null;
  lastService: { date: string; vendor: string | null; summary: string | null; odometer: number | null } | null;
  documents: number;
}

const UPKEEP: CostType[] = ["repair", "maintenance", "tires"];

export function summarizeVehicle(v: Vehicle, entries: CostEntry[], data: Pick<CarData, "docs" | "assets" | "today">): VehicleSummary {
  const now = data.today;
  const docs = data.docs;
  const mine = entries.filter((e) => e.vehicleId === v.id);
  const myDocs = docs.filter((d) => d.vehicleId === v.id && d.status === "done");
  const running: Record<string, number> = {};
  const byYearMap = new Map<string, Record<string, number>>();
  let paidTowardCar = 0;
  const yearAgo = addYears(now, -1);
  const twoYearsAgo = addYears(now, -2);
  let upkeepLast12 = 0;
  let upkeepPrior12 = 0;
  let runningLast12 = 0;

  for (const e of mine) {
    if (OWNERSHIP_ONLY.includes(e.costType)) {
      paidTowardCar += e.amount;
      continue;
    }
    running[e.costType] = (running[e.costType] || 0) + e.amount;
    const year = e.date.slice(0, 4);
    const y = byYearMap.get(year) || {};
    y[e.costType] = (y[e.costType] || 0) + e.amount;
    byYearMap.set(year, y);
    if (e.date > yearAgo) runningLast12 += e.amount;
    if (UPKEEP.includes(e.costType)) {
      if (e.date > yearAgo) upkeepLast12 += e.amount;
      else if (e.date > twoYearsAgo) upkeepPrior12 += e.amount;
    }
  }
  for (const k of Object.keys(running)) running[k] = round(running[k]);
  const runningTotal = round(Object.values(running).reduce((s, n) => s + n, 0));

  // Current value: the sale price once sold, else the linked asset, else the typed estimate
  let currentValue: number | null = null;
  let currentValueDate: string | null = null;
  let valueSource: VehicleSummary["valueSource"] = null;
  const asset = v.accountId ? data.assets.find((a) => a.id === v.accountId) : undefined;
  if (v.soldDate && v.salePrice != null) {
    currentValue = v.salePrice; currentValueDate = v.soldDate; valueSource = "sale";
  } else if (asset) {
    currentValue = asset.balance; currentValueDate = asset.lastUpdated?.slice(0, 10) ?? null; valueSource = "asset";
  } else if (v.valueEstimate != null) {
    currentValue = v.valueEstimate; currentValueDate = v.valueDate; valueSource = "estimate";
  }

  const depreciation = v.purchasePrice != null && currentValue != null ? round(v.purchasePrice - currentValue) : null;
  const interest = loanInterest(v, now);
  const ownershipCost = round(runningTotal + (depreciation ?? 0) + (interest?.amount ?? 0));
  const end = v.soldDate && v.soldDate < now ? v.soldDate : now;
  const start = v.purchaseDate || mine.map((e) => e.date).sort()[0] || null;
  const ownedYears = start ? Math.max(0, daysBetween(start, end) / 365.25) : null;
  // Under a few months, a yearly rate would just scale up the purchase
  const perYear = ownedYears && ownedYears >= 0.25 ? round(ownershipCost / ownedYears) : null;

  // Odometer readings: purchase, every document with a reading, sale
  const readings: OdometerReading[] = [];
  if (v.purchaseDate && v.purchaseMileage != null) readings.push({ date: v.purchaseDate, miles: v.purchaseMileage, source: "Purchase" });
  for (const d of myDocs) {
    if (d.date && d.odometer != null) readings.push({ date: d.date, miles: d.odometer, source: d.vendor || d.docType || "Document", documentId: d.id });
  }
  if (v.soldDate && v.saleMileage != null) readings.push({ date: v.soldDate, miles: v.saleMileage, source: "Sale" });
  readings.sort((a, b) => a.date.localeCompare(b.date) || a.miles - b.miles);

  const first = readings[0];
  const last = readings[readings.length - 1];
  const latestMiles = last?.miles ?? null;
  let milesPerYear: number | null = null;
  if (first && last && last !== first) {
    const years = daysBetween(first.date, last.date) / 365.25;
    if (years >= 0.25 && last.miles > first.miles) milesPerYear = Math.round((last.miles - first.miles) / years);
  }
  const estimatedMilesNow = last && milesPerYear && !v.soldDate
    ? Math.round(last.miles + (milesPerYear * daysBetween(last.date, now)) / 365.25)
    : latestMiles;
  const startMiles = v.purchaseMileage ?? first?.miles ?? null;
  const milesDriven = estimatedMilesNow != null && startMiles != null ? estimatedMilesNow - startMiles : null;
  const costPerMile = milesDriven && milesDriven >= MIN_MILES ? round(ownershipCost / milesDriven) : null;

  const service = myDocs
    .filter((d) => d.date && ["repair", "maintenance", "tires", "inspection"].includes(d.docType || ""))
    .sort((a, b) => b.date!.localeCompare(a.date!))[0];

  return {
    vehicle: v,
    currentValue, currentValueDate, valueSource,
    ownedYears: ownedYears != null ? round(ownedYears) : null,
    running, runningTotal, paidTowardCar: round(paidTowardCar),
    depreciation, interest, ownershipCost,
    perYear, perMonth: perYear != null ? round(perYear / 12) : null,
    byYear: [...byYearMap.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, byType]) => ({
        year,
        total: round(Object.values(byType).reduce((s, n) => s + n, 0)),
        byType: Object.fromEntries(Object.entries(byType).map(([k, n]) => [k, round(n)])),
      })),
    upkeepLast12: round(upkeepLast12), upkeepPrior12: round(upkeepPrior12), runningLast12: round(runningLast12),
    readings, latestMiles, milesPerYear, estimatedMilesNow, milesDriven, costPerMile,
    lastService: service ? { date: service.date!, vendor: service.vendor, summary: service.summary, odometer: service.odometer } : null,
    documents: myDocs.length,
  };
}

// ── Gaps ───────────────────────────────────────────────────────────

export interface Gaps {
  /** Car-category charges no link or rule assigns to a car, grouped by merchant */
  unassigned: { merchant: string; payeeId: string | null; category: string; count: number; total: number; first: string; last: string }[];
  unassignedTotal: number;
  /** Car charges big enough to expect a receipt, with no document pointing at them */
  missingReceipts: { transactionId: string; date: string; merchant: string; amount: number; vehicleId: string | null }[];
  /** Read documents with a total but no bank charge found, and not marked as paid elsewhere */
  unmatchedDocuments: { id: string; date: string | null; vendor: string | null; total: number; vehicleId: string | null }[];
  /** Documents not read yet */
  unread: number;
}

export function findGaps(data: CarData, covered: Set<string>, entries: CostEntry[]): Gaps {
  const carTxns = data.txns.filter((t) => CAR_CATEGORIES.includes(t.category) && SPENDING_KINDS.includes(t.kind));
  const groups = new Map<string, Gaps["unassigned"][number]>();
  for (const t of carTxns) {
    if (covered.has(t.id)) continue;
    const key = t.payeeId || t.merchant;
    const g = groups.get(key) || { merchant: t.merchant, payeeId: t.payeeId, category: t.category, count: 0, total: 0, first: t.date, last: t.date };
    g.count++;
    g.total = round(g.total + spent(t));
    if (t.date < g.first) g.first = t.date;
    if (t.date > g.last) g.last = t.date;
    groups.set(key, g);
  }
  const unassigned = [...groups.values()].sort((a, b) => b.total - a.total);

  const docs = data.docs;
  const withDoc = new Set(docs.map((d) => d.transactionId).filter(Boolean));
  const vehicleOf = new Map<string, string>();
  for (const e of entries) if (e.transactionId && e.share === 1) vehicleOf.set(e.transactionId, e.vehicleId);
  const carIds = new Set(carTxns.map((t) => t.id));
  // Upkeep charges assigned to a car count too, whatever their bank category
  const upkeepIds = new Set(entries.filter((e) => e.transactionId && UPKEEP.includes(e.costType)).map((e) => e.transactionId!));
  const missingReceipts = data.txns
    .filter((t) => t.kind === "spend" && (carIds.has(t.id) || upkeepIds.has(t.id)) && spent(t) >= RECEIPT_WORTHY && !withDoc.has(t.id))
    .filter((t) => t.category !== "Gas")
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => ({ transactionId: t.id, date: t.date, merchant: t.merchant, amount: round(spent(t)), vehicleId: vehicleOf.get(t.id) ?? null }));

  const unmatchedDocuments = docs
    .filter((d) => d.status === "done" && d.total && d.total > 0 && !d.transactionId && !d.paidOutside && d.docType !== "sale")
    .map((d) => ({ id: d.id, date: d.date, vendor: d.vendor, total: d.total!, vehicleId: d.vehicleId }));

  return {
    unassigned,
    unassignedTotal: round(unassigned.reduce((s, g) => s + g.total, 0)),
    missingReceipts,
    unmatchedDocuments,
    unread: docs.filter((d) => d.status === "new").length,
  };
}

// ── Household context for an upgrade ──────────────────────────────

export interface UpgradeContext {
  /** Checking, savings and cash accounts on the Assets page */
  liquidCash: number;
  liquidAccounts: { type: string; institution: string | null; owner: string | null; balance: number }[];
  /** Average over the last 12 full months of imported data */
  monthlySpending: number;
  monthlyIncome: number;
  goals: { name: string; remaining: number; deadline: string | null; priority: string }[];
  goalsRemaining: number;
}

export function upgradeContext(data: CarData): UpgradeContext {
  const liquid = data.assets.filter((a) => /checking|savings|money market|hysa|cash/i.test(a.type));
  const thisMonth = data.today.slice(0, 7);
  // The 12 full months before this one
  const firstFull = `${Number(thisMonth.slice(0, 4)) - 1}${thisMonth.slice(4)}`;
  const rows = data.txns.filter((t) => t.month >= firstFull && t.month < thisMonth);
  const months = new Set(rows.map((r) => r.month)).size || 1;
  const spending = rows.filter((r) => SPENDING_KINDS.includes(r.kind)).reduce((s, r) => s - r.amount, 0);
  const income = rows.filter((r) => r.kind === "income").reduce((s, r) => s + r.amount, 0);
  const openGoals = data.goals
    .filter((g) => !g.completedAt && g.targetAmount > g.savedAmount)
    .map((g) => ({ name: g.name, remaining: round(g.targetAmount - g.savedAmount), deadline: g.deadline, priority: g.priority }));
  return {
    liquidCash: round(liquid.reduce((s, a) => s + a.balance, 0)),
    liquidAccounts: liquid.map((a) => ({ type: a.type, institution: a.institution, owner: a.owner, balance: a.balance })),
    monthlySpending: round(spending / months),
    monthlyIncome: round(income / months),
    goals: openGoals,
    goalsRemaining: round(openGoals.reduce((s, g) => s + g.remaining, 0)),
  };
}

// ── Everything for the Cars page ───────────────────────────────────

export function carsOverview(data: CarData) {
  const { entries, covered } = costEntries(data);
  const summaries = data.cars
    .map((v) => summarizeVehicle(v, entries, data))
    .sort((a, b) => Number(!!a.vehicle.soldDate) - Number(!!b.vehicle.soldDate) || (b.vehicle.purchaseDate || "").localeCompare(a.vehicle.purchaseDate || ""));
  const gaps = findGaps(data, covered, entries);

  const yearAgo = addYears(data.today, -1);
  const running = entries.filter((e) => !OWNERSHIP_ONLY.includes(e.costType));
  const byYear = new Map<string, number>();
  for (const e of running) byYear.set(e.date.slice(0, 4), (byYear.get(e.date.slice(0, 4)) || 0) + e.amount);

  return {
    vehicles: summaries,
    household: {
      runningTotal: round(running.reduce((s, e) => s + e.amount, 0)),
      runningLast12: round(running.filter((e) => e.date > yearAgo).reduce((s, e) => s + e.amount, 0)),
      ownershipTotal: round(summaries.reduce((s, v) => s + v.ownershipCost, 0)),
      byYear: [...byYear.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([year, total]) => ({ year, total: round(total) })),
      /** Car-category charges not assigned to any car yet, not in the totals above */
      unassignedTotal: gaps.unassignedTotal,
    },
    gaps,
    context: upgradeContext(data),
  };
}
