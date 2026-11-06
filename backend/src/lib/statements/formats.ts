/**
 * Bank / card CSV formats. Each format is recognized from its header row and
 * turns its rows into one shape with a single sign convention:
 *   negative = money leaving you (purchase, fee, bill paid from checking)
 *   positive = money coming in (paycheck, refund, a payment received by a card)
 *
 * To support a new bank: add a Format here. Nothing else needs to change.
 */
import { parseCsvRecords } from "./csv.js";
import {
  CARD_PAYMENT, FEE, INTEREST, INTEREST_EARNED, OWN_TRANSFER, PAYCHECK, PAYMENT_RECEIVED,
  normalizeMerchant,
} from "./merchant.js";

export type Kind = "spend" | "income" | "refund" | "transfer" | "fee" | "interest";
export const KINDS: Kind[] = ["spend", "income", "refund", "transfer", "fee", "interest"];

export interface ParsedRow {
  date: string; // YYYY-MM-DD
  postedDate: string | null;
  amount: number;
  description: string;
  merchant: string;
  category: string;
  kind: Kind;
  member: string | null;
  /** Extra text that makes otherwise identical rows distinct (e.g. Ally's time of day) */
  uniq: string;
  raw: Record<string, string>;
}

export interface AccountInfo {
  id: string;
  institution: string;
  name: string;
  kind: "checking" | "credit";
  last4: string | null;
}

export interface ParsedFile {
  format: string;
  account: AccountInfo;
  rows: ParsedRow[];
}

interface Format {
  id: string;
  matches: (headers: string[]) => boolean;
  account: (fileName: string, records: Record<string, string>[]) => AccountInfo;
  row: (r: Record<string, string>) => ParsedRow | null;
}

// ── Helpers ───────────────────────────────────────────────────────

function has(headers: string[], ...names: string[]) {
  return names.every((n) => headers.includes(n));
}

/** MM/DD/YYYY, M/D/YY or YYYY-MM-DD → YYYY-MM-DD */
export function isoDate(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

/** "$1,234.56", "-12.00", "(12.00)" → number */
export function money(v: string | undefined): number | null {
  if (v == null) return null;
  let s = v.trim().replace(/[$,\s]/g, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round((neg ? -n : n) * 100) / 100;
}

/** Bank categories that only restate the transaction type aren't useful as categories */
function category(v: string | undefined, kind: Kind, description: string): string {
  if (kind === "income" && PAYCHECK.test(description)) return "Paycheck";
  if (kind === "transfer") return "Transfer";
  if (kind === "interest") return "Interest";
  if (kind === "fee") return "Fees";
  const c = (v || "").trim();
  if (!c || /^(payment|credit|debit|other)$/i.test(c)) return "Uncategorized";
  return c;
}

/** Kind for a checking-account row, from the description alone */
function bankKind(amount: number, description: string, typeHint = ""): Kind {
  if (CARD_PAYMENT.test(description) || OWN_TRANSFER.test(description) || /XFER/i.test(typeHint)) return "transfer";
  if (amount > 0) return INTEREST_EARNED.test(description) ? "interest" : "income";
  if (FEE.test(description) || /FEE/i.test(typeHint)) return "fee";
  return "spend";
}

function build(
  r: Record<string, string>,
  fields: {
    date: string | null;
    postedDate?: string | null;
    amount: number | null;
    description: string;
    merchant?: string;
    category?: string;
    kind: Kind;
    member?: string | null;
    uniq?: string;
  }
): ParsedRow | null {
  if (!fields.date || fields.amount == null || !fields.description) return null;
  return {
    date: fields.date,
    postedDate: fields.postedDate ?? null,
    amount: fields.amount,
    description: fields.description,
    merchant: fields.merchant?.trim() ? fields.merchant.trim() : normalizeMerchant(fields.description),
    category: category(fields.category, fields.kind, fields.description),
    kind: fields.kind,
    member: fields.member?.trim() || null,
    uniq: fields.uniq ?? "",
    raw: r,
  };
}

/** Most common non-empty value, for picking an account number out of a column */
function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (!best || n > counts.get(best)!) best = v;
  return best;
}

// ── Formats ───────────────────────────────────────────────────────

const chaseCard: Format = {
  id: "chase-card",
  matches: (h) => has(h, "transaction date", "post date", "description", "category", "type", "amount"),
  account: (fileName) => {
    const last4 = fileName.match(/chase(\d{4})/i)?.[1] ?? null;
    return {
      id: last4 ? `chase-${last4}` : "chase-card",
      institution: "Chase",
      name: last4 ? `Chase card ··${last4}` : "Chase card",
      kind: "credit",
      last4,
    };
  },
  row: (r) => {
    const amount = money(r["amount"]);
    const description = r["description"];
    const type = (r["type"] || "").toLowerCase();
    let kind: Kind =
      type === "payment" ? "transfer"
      : type === "return" ? "refund"
      : type === "fee" ? "fee"
      : (amount ?? 0) > 0 ? "refund"
      : "spend";
    if (INTEREST.test(description)) kind = "interest";
    return build(r, {
      date: isoDate(r["transaction date"]),
      postedDate: isoDate(r["post date"]),
      amount,
      description,
      category: r["category"],
      kind,
    });
  },
};

const chaseChecking: Format = {
  id: "chase-checking",
  matches: (h) => has(h, "details", "posting date", "description", "amount", "type", "balance"),
  account: (fileName) => {
    const last4 = fileName.match(/chase(\d{4})/i)?.[1] ?? null;
    return {
      id: last4 ? `chase-${last4}` : "chase-checking",
      institution: "Chase",
      name: last4 ? `Chase checking ··${last4}` : "Chase checking",
      kind: "checking",
      last4,
    };
  },
  row: (r) => {
    const amount = money(r["amount"]);
    const description = r["description"];
    return build(r, {
      date: isoDate(r["posting date"]),
      postedDate: isoDate(r["posting date"]),
      amount,
      description,
      kind: bankKind(amount ?? 0, description, r["type"]),
      uniq: r["balance"] || "",
    });
  },
};

const appleCard: Format = {
  id: "apple-card",
  matches: (h) => has(h, "transaction date", "clearing date", "description", "merchant", "amount (usd)"),
  account: () => ({ id: "apple-card", institution: "Apple", name: "Apple Card", kind: "credit", last4: null }),
  row: (r) => {
    const raw = money(r["amount (usd)"]);
    const amount = raw == null ? null : -raw; // Apple lists purchases as positive
    const description = r["description"];
    const type = (r["type"] || "").toLowerCase();
    let kind: Kind =
      type === "payment" ? "transfer"
      : type === "credit" ? "refund"
      : (amount ?? 0) > 0 ? "refund"
      : "spend";
    if (INTEREST.test(description)) kind = "interest";
    else if (kind === "spend" && type === "debit" && FEE.test(description)) kind = "fee";
    return build(r, {
      date: isoDate(r["transaction date"]),
      postedDate: isoDate(r["clearing date"]),
      amount,
      description,
      merchant: kind === "spend" || kind === "refund" ? r["merchant"] : undefined,
      category: r["category"],
      kind,
      member: r["purchased by"],
    });
  },
};

const amex: Format = {
  id: "amex",
  matches: (h) => has(h, "date", "description", "amount") && (h.includes("card member") || h.includes("account #")),
  account: (_fileName, records) => {
    const acct = mostCommon(records.map((r) => (r["account #"] || "").replace(/\D/g, "")));
    return {
      id: acct ? `amex-${acct}` : "amex",
      institution: "Amex",
      name: acct ? `Amex ··${acct}` : "Amex",
      kind: "credit",
      last4: acct,
    };
  },
  row: (r) => {
    const raw = money(r["amount"]);
    const amount = raw == null ? null : -raw; // Amex lists charges as positive
    const description = r["description"];
    let kind: Kind =
      PAYMENT_RECEIVED.test(description) ? "transfer"
      : INTEREST.test(description) ? "interest"
      : FEE.test(description) && (amount ?? 0) < 0 ? "fee"
      : (amount ?? 0) > 0 ? "refund"
      : "spend";
    return build(r, {
      date: isoDate(r["date"]),
      amount,
      description,
      category: r["category"],
      kind,
      member: r["card member"],
      uniq: r["reference"] || "",
    });
  },
};

const ally: Format = {
  id: "ally",
  matches: (h) => has(h, "date", "time", "amount", "type", "description"),
  account: () => ({ id: "ally-checking", institution: "Ally", name: "Ally checking", kind: "checking", last4: null }),
  row: (r) => {
    const amount = money(r["amount"]);
    const description = r["description"];
    return build(r, {
      date: isoDate(r["date"]),
      amount,
      description,
      kind: bankKind(amount ?? 0, description),
      uniq: r["time"] || "",
    });
  },
};

const FORMATS: Format[] = [chaseCard, chaseChecking, appleCard, amex, ally];

export class UnrecognizedFormatError extends Error {
  constructor(public headers: string[]) {
    super(`Unrecognized CSV columns: ${headers.join(", ") || "(empty file)"}`);
    this.name = "UnrecognizedFormatError";
  }
}

export function parseStatement(text: string, fileName: string): ParsedFile {
  const { headers, records } = parseCsvRecords(text);
  const format = FORMATS.find((f) => f.matches(headers));
  if (!format) throw new UnrecognizedFormatError(headers);
  const rows = records.map(format.row).filter((r): r is ParsedRow => r !== null);
  return { format: format.id, account: format.account(fileName, records), rows };
}
