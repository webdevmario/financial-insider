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

/** One suggested line in the mid-month plan */
export interface PlanLine {
  key: string;
  label: string;
  amount: number;
  note: string;
  date?: string;
}

/** Suggested lines for planning the 16th to month-end */
export interface MidMonthPlan {
  month: string;
  window: { start: string; end: string };
  asOf: string;
  dataComplete: boolean;
  bills: PlanLine[];
  pending: PlanLine[];
  work: PlanLine[];
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
  date: string;
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

// ── Credit cards (rewards vs real spending) ────────────────────────
export type RewardUnit = "percent" | "points";

export interface CreditCard {
  id: string;
  name: string;
  issuer: string | null;
  /** The imported statement account its spending comes from */
  statementAccountId: string | null;
  annualFee: number;
  rewardUnit: RewardUnit;
  /** Cents one point is worth (points cards only; 1 when unset) */
  pointValue: number | null;
  /** Category → rate; "*" is everything else; "@Payee" is one store */
  rewardRates: Record<string, number>;
  /** Rate key → yearly spend the bonus rate covers before "*" applies */
  rewardCaps?: Record<string, number>;
  benefits: string | null;
  lastReviewed: string | null;
  inUse: boolean;
  createdAt: string;
}

export interface CardCategoryRow {
  category: string;
  spend: number;
  rate: number;
  /** In the card's unit: dollars for cash back, points for points */
  earned: number;
  /** In dollars */
  value: number;
}

interface CardResultBase {
  id: string;
  name: string;
  issuer: string | null;
  inUse: boolean;
  rewardUnit: RewardUnit;
  pointValue: number | null;
  annualFee: number;
  statementAccountId: string | null;
  accountName: string | null;
}

export type CardResult =
  | (CardResultBase & { linked: false })
  | (CardResultBase & {
      linked: true;
      firstDate: string | null;
      lastDate: string | null;
      spend: number;
      earned: number;
      value: number;
      feesAndInterest: number;
      rewardCredits: number;
      valueLessFee: number;
      categories: CardCategoryRow[];
    });

export interface CardCategoryOption {
  cardId: string;
  name: string;
  rate: number;
  rewardUnit: RewardUnit;
  earned: number;
  value: number;
}

export interface CardAnalysis {
  from: string;
  to: string;
  months: number;
  cards: CardResult[];
  byCategory: {
    category: string;
    /** Combined spending on every linked card */
    spend: number;
    /** What the cards it was actually charged to earned on it */
    actualValue: number;
    best: CardCategoryOption | null;
    options: CardCategoryOption[];
  }[];
  categories: string[];
}
