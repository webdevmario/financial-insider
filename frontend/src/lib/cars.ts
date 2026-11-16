import type { CarDocType, CostType, UpgradeContext, VehicleSummary } from "../types";

export const COST_LABELS: Record<CostType, string> = {
  repair: "Repairs",
  maintenance: "Maintenance",
  tires: "Tires",
  insurance: "Insurance",
  fuel: "Gas",
  registration: "Registration & inspection",
  parking: "Parking & tolls",
  other: "Other",
  purchase: "Toward purchase",
  loan: "Loan payments",
};

/** Running costs, in the order the breakdowns list them */
export const RUNNING_TYPES: CostType[] = ["fuel", "insurance", "repair", "maintenance", "tires", "registration", "parking", "other"];
/** Every type a charge can be assigned as */
export const ASSIGNABLE_TYPES: CostType[] = [...RUNNING_TYPES, "purchase", "loan"];

export const DOC_TYPE_LABELS: Record<CarDocType, string> = {
  purchase: "Bill of sale / purchase",
  sale: "Sale or trade-in",
  loan: "Loan papers",
  repair: "Repair",
  maintenance: "Maintenance",
  tires: "Tires",
  insurance: "Insurance",
  registration: "Registration",
  inspection: "Inspection",
  fuel: "Gas",
  parking: "Parking & tolls",
  other: "Other",
};
export const DOC_TYPES = Object.keys(DOC_TYPE_LABELS) as CarDocType[];

/** Cost type a document type stands for (mirrors the server) */
export function docCostType(t: CarDocType | null): CostType | null {
  if (!t || t === "sale") return null;
  if (t === "inspection") return "registration";
  return t;
}

export function carTitle(v: { year: number | null; make: string | null; model: string | null }): string {
  return [v.year, v.make, v.model].filter(Boolean).join(" ");
}

export const miles = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString("en-US")} mi`);

// ── Upgrade math ──────────────────────────────────────────────────

export interface UpgradeInputs {
  /** Price of the replacement, out the door */
  price: number;
  /** What the current car brings as a trade-in or sale */
  tradeIn: number;
  /** Years you'd keep the replacement */
  years: number;
  /** Replacement's value after those years, as a percent of its price */
  resalePct: number;
  /** Amount financed (0 = cash) */
  loanAmount: number;
  loanRate: number;
  loanMonths: number;
  /** Expected yearly repairs and maintenance on the replacement */
  newUpkeep: number;
  /** Expected yearly repairs and maintenance if you keep the current car */
  keepUpkeep: number;
  /** How much more (or less) insurance would cost per year */
  insuranceChange: number;
  /** Yearly drop in the current car's value, as a percent */
  keepDepreciationPct: number;
  /** Months of spending to leave untouched */
  emergencyMonths: number;
}

export interface UpgradeResult {
  keepPerYear: number;
  keepDepreciation: number;
  replacePerYear: number;
  replaceDepreciation: number;
  interestPerYear: number;
  monthlyPayment: number;
  /** Positive: keeping is cheaper by this much a year */
  keepSaves: number;
  /** Yearly repairs on the current car at which replacing costs the same */
  breakEvenUpkeep: number;
  cashNeeded: number;
  emergencyFund: number;
  /** Cash left after the emergency fund and open goals, before the purchase */
  cushion: number;
  cushionAfter: number;
  /** What's left each month after usual spending (and the new payment) */
  monthlySurplus: number;
  monthlySurplusAfter: number;
}

export function loanPayment(amount: number, ratePct: number, months: number): number {
  if (amount <= 0 || months <= 0) return 0;
  const r = ratePct / 100 / 12;
  return r === 0 ? amount / months : (amount * r) / (1 - Math.pow(1 + r, -months));
}

export function upgradeMath(i: UpgradeInputs, current: VehicleSummary | null, ctx: UpgradeContext): UpgradeResult {
  const currentValue = current?.currentValue ?? i.tradeIn;
  const keepDepreciation = (currentValue * i.keepDepreciationPct) / 100;
  const keepPerYear = i.keepUpkeep + keepDepreciation;

  const years = Math.max(1, i.years);
  const resale = (i.price * i.resalePct) / 100;
  const replaceDepreciation = (i.price - resale) / years;
  const payment = loanPayment(i.loanAmount, i.loanRate, i.loanMonths);
  const totalInterest = Math.max(0, payment * i.loanMonths - i.loanAmount);
  const interestPerYear = totalInterest / years;
  const replacePerYear = replaceDepreciation + interestPerYear + i.newUpkeep + i.insuranceChange;

  const cashNeeded = Math.max(0, i.price - i.tradeIn - i.loanAmount);
  const emergencyFund = ctx.monthlySpending * i.emergencyMonths;
  const cushion = ctx.liquidCash - emergencyFund - ctx.goalsRemaining;
  const monthlySurplus = ctx.monthlyIncome - ctx.monthlySpending;

  return {
    keepPerYear,
    keepDepreciation,
    replacePerYear,
    replaceDepreciation,
    interestPerYear,
    monthlyPayment: payment,
    keepSaves: replacePerYear - keepPerYear,
    breakEvenUpkeep: replacePerYear - keepDepreciation,
    cashNeeded,
    emergencyFund,
    cushion,
    cushionAfter: cushion - cashNeeded,
    monthlySurplus,
    monthlySurplusAfter: monthlySurplus - payment,
  };
}

/** Starting guesses from the car's own history */
export function defaultUpgradeInputs(current: VehicleSummary | null): UpgradeInputs {
  const upkeep = current ? Math.max(current.upkeepLast12, (current.upkeepLast12 + current.upkeepPrior12) / 2) : 1200;
  return {
    price: 35000,
    tradeIn: Math.round(current?.currentValue ?? 0),
    years: 8,
    resalePct: 35,
    loanAmount: 0,
    loanRate: 6.5,
    loanMonths: 60,
    newUpkeep: 600,
    keepUpkeep: Math.round(upkeep),
    insuranceChange: 0,
    keepDepreciationPct: 10,
    emergencyMonths: 6,
  };
}

/** File → base64 (no data: prefix), in chunks so large files don't overflow the call stack */
export async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
