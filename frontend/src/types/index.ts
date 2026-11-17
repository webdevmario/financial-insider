// ── Account (Asset) ────────────────────────────────────────────
export interface Account {
  id: string;
  type: AccountType;
  balance: number;
  owner: string | null;
  institution: string | null;
  notes: string | null;
  homeValue: number | null;
  mortgageBalance: number | null;
  lastUpdated: string | null;
  createdAt: string;
}

export type AccountType =
  | "Checking"
  | "Savings"
  | "Roth 401k"
  | "401k"
  | "IUL"
  | "Rollover IRA"
  | "Roth IRA"
  | "IRA"
  | "HSA"
  | "Brokerage"
  | "Home Equity"
  | "Vehicle"
  | "Crypto"
  | "Other";

// ── Subscription (Bill) ────────────────────────────────────────
export interface Subscription {
  id: string;
  name: string;
  category: string;
  frequency: "monthly" | "quarterly" | "annual";
  amount: number;
  nextCharge: string | null;
  splitBy: number;
  status: string | null;
  /** null while active; paused and cancelled bills stay listed but aren't counted or expected */
  state?: "paused" | "cancelled" | null;
  /** When it was paused or cancelled (YYYY-MM-DD) */
  stateSince?: string | null;
  notes: string | null;
  priceHistory: { date: string; amount: number }[];
  createdAt: string;
  /** "listed" pins totals to the typed amount; otherwise they use the projection */
  amountMode?: "listed" | null;
  /** What real charges say it will cost (from the server; absent offline for new bills) */
  projection?: BillProjection | null;
}

/** One thing that costs more than it did a year ago */
export interface CostChange {
  name: string;
  before: number;
  now: number;
  pct: number;
  per: string;
  monthly?: number;
  detail?: string;
}

/** Dashboard: what costs more, the past 12 full months against the 12 before */
export interface CostChanges {
  recent: { from: string; to: string };
  prior: { from: string; to: string };
  food: {
    groceries: { before: { perMonth: number; timesPerMonth: number }; now: { perMonth: number; timesPerMonth: number } };
    dining: { before: { perMonth: number; timesPerMonth: number }; now: { perMonth: number; timesPerMonth: number } };
  } | null;
  places: CostChange[];
  bills: CostChange[];
}

/** Dashboard: this year's spending against the two years before */
export interface YearOverYear {
  /** MM-DD the year-to-date comparison runs through */
  through: string;
  years: {
    year: number;
    /** Spending per month; null for months still ahead */
    monthly: (number | null)[];
    ytd: { spent: number; income: number; saved: number; net: number };
    fullYear: { spent: number; income: number; net: number } | null;
  }[];
  changes: { category: string; before: number; now: number; diff: number }[];
}

export interface BillProjection {
  /** Projected full charge: this month's for monthly bills, the next charge's otherwise */
  amount: number;
  method: "last" | "seasonal" | "average" | "listed";
  basis: string;
  reason: "no-history" | "mismatch" | null;
  /** Monthly totals (monthly bills) or single charges (others), oldest first */
  history: { label: string; amount: number }[];
}

// ── Expense ────────────────────────────────────────────────────
export interface Expense {
  id: string;
  date: string;
  month: string;
  description: string;
  category: string;
  amount: number;
  updatedAt?: string | null;
  /** Client-only: saved on this device but not yet synced to the server */
  pending?: boolean;
}

// ── Goal (Savings target) ──────────────────────────────────────
export type GoalPriority = "high" | "medium" | "low";

export interface GoalHistoryEntry {
  date: string;
  /** Change to the saved amount: positive for a contribution, negative for a withdrawal */
  amount: number;
  note?: string;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  deadline: string | null;
  priority: GoalPriority;
  notes: string | null;
  history: GoalHistoryEntry[];
  completedAt: string | null;
  createdAt: string;
}

// ── Imported transactions ──────────────────────────────────────
export type TxnKind = "spend" | "income" | "refund" | "transfer" | "fee" | "interest";

export interface Transaction {
  id: string;
  accountId: string;
  /** The day it happened: the bank's date unless corrected by hand */
  date: string;
  /** The bank's own date, set only when `date` was corrected by hand */
  bankDate: string | null;
  postedDate: string | null;
  month: string;
  /** Negative = money leaving you; positive = money coming in */
  amount: number;
  description: string;
  merchant: string;
  category: string;
  kind: TxnKind;
  member: string | null;
  transferPeerId: string | null;
  /** 1 = category/type changed by hand on this transaction */
  edited: number;
  /** What the bank's description cleaned up to, before payees */
  baseMerchant: string | null;
  payeeId: string | null;
  /** 1 = payee picked by hand for this transaction */
  payeeLocked: number;
}

export interface StatementAccount {
  id: string;
  institution: string;
  name: string;
  kind: "checking" | "credit";
  last4: string | null;
  count: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface ImportResult {
  batchId: string;
  fileName: string;
  format: string;
  accountId: string;
  accountName: string;
  rowCount: number;
  inserted: number;
  duplicates: number;
  dateFrom: string | null;
  dateTo: string | null;
}

export interface ScanResult {
  scannedAt: string;
  folder: string;
  imported: ImportResult[];
  skipped: number;
  unrecognized: { file: string; error: string }[];
}

export interface ImportBatch {
  id: string;
  fileName: string;
  sourcePath: string | null;
  status: "imported" | "undone";
  format: string;
  accountId: string;
  rowCount: number;
  inserted: number;
  duplicates: number;
  dateFrom: string | null;
  dateTo: string | null;
  importedAt: string;
}

export type AliasMatch = "contains" | "starts" | "exact" | "merchant";

export interface PayeeAlias {
  id: string;
  payeeId: string;
  pattern: string;
  match: AliasMatch;
  amount: number | null;
  createdAt: string;
  /** Transactions this alias currently matches */
  matched: number;
}

export interface Payee {
  id: string;
  name: string;
  category: string | null;
  kind: TxnKind | null;
  billId: string | null;
  notes: string | null;
  createdAt: string;
  count: number;
  /** Money out (spend, fees, interest charged) */
  spent: number;
  /** Money in (income, refunds, interest earned) */
  received: number;
  lastDate: string | null;
  aliases: PayeeAlias[];
  handPicked: number;
}

export interface PayeeDetail extends Payee {
  /** amount is money out that month, received is money in */
  monthly: { month: string; amount: number; received: number }[];
  /** Each bank name filed under this payee; aliasId is the alias catching most of them */
  bankNames: { name: string; count: number; aliasId: string | null; handPicked: number }[];
  /** Transactions from the 12 months ending with the latest one (capped at 500) */
  recent: Transaction[];
}

export interface UnassignedMerchant {
  key: string;
  merchant: string;
  count: number;
  spent: number;
  received: number;
  lastDate: string;
  samples: string[];
  kinds: TxnKind[];
}

/** One transaction behind a "No payee yet" bank name */
export interface UnassignedTxn {
  id: string;
  date: string;
  /** As the bank wrote it: what aliases match on */
  description: string;
  accountId: string;
  account: string;
  amount: number;
  kind: TxnKind;
}

export interface AliasPreview {
  count: number;
  total: number;
  merchants: string[];
  samples: { id: string; date: string; description: string; amount: number; payee: string | null }[];
}

export interface MonthSummary {
  spent: number;
  refunds: number;
  netSpent: number;
  income: number;
  net: number;
  fees: number;
  interest: number;
  transfersExcluded: number;
  count: number;
}

export interface BillVsActual {
  id: string;
  name: string;
  frequency: string;
  listedAmount: number;
  /** Payee linked to this bill; null when matched by words in the bill's name */
  linkedPayee: string | null;
  matched: number;
  lastDate: string | null;
  lastAmount: number | null;
  avgAmount: number | null;
  diff: number | null;
  notSeenRecently: boolean;
  state: "active" | "paused" | "cancelled";
  stateSince: string | null;
  /** Charges dated after the bill was paused or cancelled */
  chargedSinceStopped: number;
}

export interface Insights {
  months: string[];
  month: string;
  prevMonth: string | null;
  asOf: string;
  /** The month is still in progress; prevSummary then covers the same days of last month */
  partial: boolean;
  summary: MonthSummary;
  prevSummary: MonthSummary | null;
  byCategory: { category: string; amount: number }[];
  topMerchants: { merchant: string; amount: number; count: number }[];
  byAccount: { accountId: string; name: string; spent: number; count: number }[];
  billsVsActual: BillVsActual[];
  paychecks: { id: string; date: string; amount: number; description: string; accountId: string }[];
  expectedPaycheck: number;
}

// ── Settings ───────────────────────────────────────────────────
export interface AppSettings {
  paycheck: number;
  income: number;
  paycheckHistory: { date: string; amount: number }[];
  budgetTargets: Record<string, number>;
}

// ── Constants ──────────────────────────────────────────────────
export const ACCOUNT_TYPES: AccountType[] = [
  "Checking", "Savings", "Roth 401k", "401k", "IUL", "Rollover IRA",
  "Roth IRA", "IRA", "HSA", "Brokerage", "Home Equity", "Vehicle",
  "Crypto", "Other",
];

export const ACCT_ICONS: Record<string, string> = {
  Checking: "🏦", Savings: "💰", "Roth 401k": "📈", "401k": "📈",
  IUL: "🛡️", "Rollover IRA": "🔄", "Roth IRA": "🏛️", IRA: "🏛️",
  HSA: "🏥", Brokerage: "📊", "Home Equity": "🏠", Vehicle: "🚗",
  Crypto: "₿", Other: "📁",
};

export const INSTITUTIONS = [
  "", "Ally", "E*Trade", "Fidelity", "HSA Bank", "Pacific Life",
  "PennyMac", "Robinhood", "Employer Plan", "Other",
];

export const OWNERS = ["", "Mario", "Vivian", "Joint"];

export const SUB_CATEGORIES = [
  "Housing", "Utilities", "Insurance", "Home Services",
  "Streaming", "Software", "Memberships", "Donations", "Other",
];

export const EXPENSE_CATEGORIES = [
  "Groceries", "Dining", "Gas", "Shopping", "Medical",
  "Home", "Kids", "Entertainment", "Travel", "Other",
];


// ── Cars ──────────────────────────────────────────────────────

export type CostType = "repair" | "maintenance" | "tires" | "insurance" | "fuel" | "registration" | "parking" | "other" | "purchase" | "loan";
export type CarDocType =
  | "purchase" | "sale" | "loan" | "repair" | "maintenance" | "tires" | "insurance"
  | "registration" | "inspection" | "fuel" | "parking" | "other";

export interface Vehicle {
  id: string;
  name: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  plate: string | null;
  driver: string | null;
  accountId: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  purchaseMileage: number | null;
  purchasedFrom: string | null;
  tradeInValue: number | null;
  loanAmount: number | null;
  loanRate: number | null;
  loanMonths: number | null;
  interestPaid: number | null;
  soldDate: string | null;
  salePrice: number | null;
  saleMileage: number | null;
  valueEstimate: number | null;
  valueDate: string | null;
  notes: string | null;
  createdAt: string;
}

export interface OdometerReading {
  date: string;
  miles: number;
  source: string;
  documentId?: string;
}

export interface VehicleSummary {
  vehicle: Vehicle;
  currentValue: number | null;
  currentValueDate: string | null;
  valueSource: "asset" | "estimate" | "sale" | null;
  ownedYears: number | null;
  running: Partial<Record<CostType, number>>;
  runningTotal: number;
  paidTowardCar: number;
  depreciation: number | null;
  interest: { amount: number; estimated: boolean } | null;
  ownershipCost: number;
  perYear: number | null;
  perMonth: number | null;
  byYear: { year: string; total: number; byType: Partial<Record<CostType, number>> }[];
  upkeepLast12: number;
  upkeepPrior12: number;
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

export interface CarCostEntry {
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
  share?: number;
}

export interface CarDocument {
  id: string;
  fileName: string;
  sourcePath: string;
  path: string | null;
  size: number;
  status: "new" | "done" | "skipped";
  vehicleId: string | null;
  docType: CarDocType | null;
  date: string | null;
  vendor: string | null;
  odometer: number | null;
  total: number | null;
  summary: string | null;
  items: { description: string; amount?: number | null }[];
  details: unknown;
  transactionId: string | null;
  paidOutside: boolean;
  notes: string | null;
  addedAt: string;
  updatedAt: string | null;
}

export interface CarGaps {
  unassigned: { merchant: string; payeeId: string | null; category: string; count: number; total: number; first: string; last: string }[];
  unassignedTotal: number;
  missingReceipts: { transactionId: string; date: string; merchant: string; amount: number; vehicleId: string | null }[];
  unmatchedDocuments: { id: string; date: string | null; vendor: string | null; total: number; vehicleId: string | null }[];
  unread: number;
}

export interface UpgradeContext {
  liquidCash: number;
  liquidAccounts: { type: string; institution: string | null; owner: string | null; balance: number }[];
  monthlySpending: number;
  monthlyIncome: number;
  goals: { name: string; remaining: number; deadline: string | null; priority: string }[];
  goalsRemaining: number;
}

export interface CarsOverview {
  vehicles: VehicleSummary[];
  household: {
    runningTotal: number;
    runningLast12: number;
    ownershipTotal: number;
    byYear: { year: string; total: number }[];
    unassignedTotal: number;
  };
  gaps: CarGaps;
  context: UpgradeContext;
}

export interface VehicleDetail {
  summary: VehicleSummary;
  entries: CarCostEntry[];
  documents: CarDocument[];
}

export interface CarRule {
  id: string;
  matchType: "payee" | "category" | "merchant";
  matchValue: string;
  costType: CostType;
  shares: Record<string, number> | null;
  dateFrom: string | null;
  dateTo: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CarCharge {
  id: string;
  date: string;
  merchant: string;
  description: string;
  amount: number;
  category: string;
  accountId: string;
}

export interface CarDocMatch {
  transactionId: string;
  date: string;
  merchant: string;
  description: string;
  amount: number;
  category: string;
  days: number;
  exactAmount: boolean;
  nameMatch: boolean;
  otherDocumentId: string | null;
  score: number;
}

// ── Investments ────────────────────────────────────────────────
export type SecurityKind = "fund" | "stock" | "crypto" | "cash" | "contract" | "other";
export type AssetClass = "us_stock" | "intl_stock" | "bond" | "cash" | "crypto" | "other";
export type HoldingRole = "core" | "play";
export type SecurityStatus = "keep" | "watch" | "remove";

export interface Security {
  id: string;
  symbol: string;
  name: string | null;
  kind: SecurityKind;
  assetClass: AssetClass;
  role: HoldingRole;
  status: SecurityStatus;
  expenseRatio: number | null;
  why: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface InvestmentTargets {
  usPct: number;
  intlPct: number;
  bondPct: number;
  bandPts: number;
  playCapPct: number;
  singleStockPct: number;
  idleCash: number;
  feeWarnPct: number;
}

export interface HoldingLine {
  holdingId: string;
  securityId: string;
  symbol: string;
  name: string | null;
  kind: SecurityKind;
  assetClass: AssetClass;
  role: HoldingRole;
  status: SecurityStatus;
  expenseRatio: number | null;
  shares: number | null;
  value: number;
  costBasis: number | null;
  gain: number | null;
  pctOfAccount: number;
}

export interface HoldingsAccount {
  accountId: string;
  label: string;
  type: string | null;
  owner: string | null;
  institution: string | null;
  asOf: string;
  total: number;
  balance: number | null;
  balanceUpdated: string | null;
  snapshotDates: string[];
  rows: HoldingLine[];
}

export interface InvestmentFlag {
  level: "warn" | "info";
  code: string;
  message: string;
  symbol?: string;
  accountId?: string;
}

export interface HoldingsOverview {
  asOf: string | null;
  targets: InvestmentTargets;
  total: number;
  byClass: {
    assetClass: AssetClass;
    label: string;
    value: number;
    pct: number;
    targetPct: number | null;
    low: number | null;
    high: number | null;
    state: "low" | "high" | "ok" | null;
  }[];
  core: number;
  play: number;
  playPct: number;
  playCap: number;
  playRoom: number;
  fees: { blendedPct: number | null; yearlyDollars: number; coveredValue: number; fundsMissingRatio: string[] };
  flags: InvestmentFlag[];
  accounts: HoldingsAccount[];
  securities: (Security & { held: boolean; value: number; pct: number; accounts: string[]; heldAs: HoldingRole[] })[];
  history: { asOf: string; total: number; usPct: number; intlPct: number; play: number }[];
}

export interface HoldingsMeta {
  kinds: SecurityKind[];
  assetClasses: AssetClass[];
  assetClassLabels: Record<AssetClass, string>;
  roles: HoldingRole[];
  statuses: SecurityStatus[];
  targets: InvestmentTargets;
  accounts: Account[];
}

export interface SnapshotRowInput {
  securityId?: string | null;
  symbol?: string;
  shares: number | null;
  value: number;
  costBasis: number | null;
  role: HoldingRole | null;
}

export interface Snapshot {
  accountId: string;
  asOf: string | null;
  rows: { id: string; securityId: string; symbol: string; shares: number | null; value: number; costBasis: number | null; role: HoldingRole | null; asOf: string }[];
}
