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
  notes: string | null;
  priceHistory: { date: string; amount: number }[];
  createdAt: string;
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
  edited: number;
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

export interface MerchantRule {
  id: string;
  pattern: string;
  merchant: string | null;
  category: string | null;
  kind: TxnKind | null;
  createdAt: string;
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

export interface RecurringCharge {
  key: string;
  merchant: string;
  category: string;
  accounts: string[];
  cadence: "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
  count: number;
  firstDate: string;
  lastDate: string;
  nextExpected: string;
  lastAmount: number;
  prevAmount: number;
  avgAmount: number;
  minAmount: number;
  maxAmount: number;
  /** Size and date of the most recent price change in the last 6 months */
  change: number;
  changeDate: string | null;
  variable: boolean;
  priceChanged: boolean;
  yearlyCost: number;
  status: "active" | "new" | "late" | "stopped";
  billId: string | null;
  billName: string | null;
  history: { date: string; amount: number }[];
}

export interface BillVsActual {
  id: string;
  name: string;
  frequency: string;
  listedAmount: number;
  matched: number;
  lastDate: string | null;
  lastAmount: number | null;
  avgAmount: number | null;
  diff: number | null;
  notSeenRecently: boolean;
}

export interface CardPayments {
  accountId: string;
  name: string;
  count: number;
  total: number;
  lastDate: string | null;
  sources: { name: string; count: number; total: number }[];
  recent: { date: string; amount: number; from: string | null }[];
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
  recurring: RecurringCharge[];
  billsVsActual: BillVsActual[];
  duplicates: { a: Transaction; b: Transaction }[];
  feesAndInterest: Transaction[];
  feesAndInterestTotal: number;
  paychecks: { id: string; date: string; amount: number; description: string; accountId: string }[];
  expectedPaycheck: number;
  cardPayments: CardPayments[];
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
