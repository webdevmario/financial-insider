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
