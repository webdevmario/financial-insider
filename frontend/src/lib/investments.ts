import type { AssetClass, HoldingRole, SecurityKind, SecurityStatus } from "../types";

export const KIND_LABELS: Record<SecurityKind, string> = {
  fund: "Fund",
  stock: "Single stock",
  crypto: "Crypto",
  cash: "Cash",
  contract: "Event contract",
  other: "Other",
};

export const CLASS_LABELS: Record<AssetClass, string> = {
  us_stock: "US stocks",
  intl_stock: "International stocks",
  bond: "Bonds",
  cash: "Cash",
  crypto: "Crypto",
  other: "Other",
};

export const ROLE_LABELS: Record<HoldingRole, string> = {
  core: "Core",
  play: "Play money",
};

export const STATUS_LABELS: Record<SecurityStatus, string> = {
  keep: "Keep",
  watch: "Watch",
  remove: "Remove",
};

export const STATUS_CHIP: Record<SecurityStatus, string> = {
  keep: "bg-green/[0.12] text-green",
  watch: "bg-amber/[0.12] text-amber",
  remove: "bg-red/[0.12] text-red",
};

export const pct1 = (n: number | null | undefined) => (n == null ? "—" : `${(Math.round(n * 10) / 10).toFixed(1)}%`);

/** Shares: whole numbers stay whole, fractions keep up to 8 places (crypto) */
export function fmtShares(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

export function parseNum(s: string): number | null {
  const t = s.replace(/[$,%\s]/g, "");
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}
