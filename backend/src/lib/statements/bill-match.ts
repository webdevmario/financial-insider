/**
 * Finding a bill's real charges: by the payee linked to it, or failing that by
 * words in the bill's name. Shared by the bill checks and the bill projections.
 */
import type { Transaction } from "../../db/schema.js";
import { merchantKey } from "./merchant.js";

export const isCost = (t: Transaction) => t.amount < 0 && (t.kind === "spend" || t.kind === "fee" || t.kind === "interest");

/** Words too generic to match a bill name against a merchant */
const GENERIC = new Set(["bill", "bills", "insurance", "payment", "monthly", "annual", "service", "services", "plan", "home", "auto", "the", "and", "card", "online"]);

export function billTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !GENERIC.has(w));
}

export function matchesBill(key: string, tokens: string[]) {
  return tokens.some((w) => key.includes(w));
}

/** A bill's charges, oldest first, and the payees linked to it (empty when matched by name) */
export function billCharges(
  bill: { id: string; name: string },
  all: Transaction[],
  payeeList: { id: string; billId: string | null }[]
): { charges: Transaction[]; linked: Set<string> } {
  const linked = new Set(payeeList.filter((p) => p.billId === bill.id).map((p) => p.id));
  const tokens = billTokens(bill.name);
  const charges = (
    linked.size
      ? all.filter((t) => isCost(t) && t.payeeId && linked.has(t.payeeId))
      : tokens.length
        ? all.filter((t) => isCost(t) && matchesBill(merchantKey(t.merchant), tokens))
        : []
  ).sort((x, y) => x.date.localeCompare(y.date));
  return { charges, linked };
}
