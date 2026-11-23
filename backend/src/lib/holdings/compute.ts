/**
 * Investment holdings math as pure functions, shared by the app (lib/holdings/load.ts) and the read-only
 * MCP (mcp/queries.ts). Values are whatever was typed from each broker on the snapshot date: no live prices.
 */

export const KINDS = ["fund", "stock", "crypto", "cash", "contract", "other"] as const;
export const ASSET_CLASSES = ["us_stock", "intl_stock", "bond", "cash", "crypto", "other"] as const;
export const ROLES = ["core", "play"] as const;
export const STATUSES = ["keep", "watch", "remove"] as const;

export type Kind = (typeof KINDS)[number];
export type AssetClass = (typeof ASSET_CLASSES)[number];
export type Role = (typeof ROLES)[number];
export type Status = (typeof STATUSES)[number];

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  us_stock: "US stocks",
  intl_stock: "International stocks",
  bond: "Bonds",
  cash: "Cash",
  crypto: "Crypto",
  other: "Other",
};

/** The written plan's numbers. Stored in settings under "investmentTargets" */
export interface InvestmentTargets {
  usPct: number;
  intlPct: number;
  bondPct: number;
  /** A class is out of band when it drifts this many points from its target */
  bandPts: number;
  /** Play money (single stocks, crypto, event contracts) as a share of all investments */
  playCapPct: number;
  /** Any one single stock above this share of all investments gets flagged */
  singleStockPct: number;
  /** Core cash above this many dollars in one account gets flagged */
  idleCash: number;
  /** Funds with an expense ratio above this percent get flagged */
  feeWarnPct: number;
}

export const DEFAULT_TARGETS: InvestmentTargets = {
  usPct: 75,
  intlPct: 25,
  bondPct: 0,
  bandPts: 5,
  playCapPct: 5,
  singleStockPct: 1,
  idleCash: 100,
  feeWarnPct: 0.5,
};

export const TARGETS_KEY = "investmentTargets";

/** Defaults, overlaid with any valid numbers from the stored setting */
export function parseTargets(raw: unknown): InvestmentTargets {
  const out = { ...DEFAULT_TARGETS };
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(DEFAULT_TARGETS) as (keyof InvestmentTargets)[]) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
    }
  }
  return out;
}

export interface SecurityRow {
  id: string;
  symbol: string;
  name: string | null;
  kind: string;
  assetClass: string;
  role: string;
  status: string;
  expenseRatio: number | null;
  why: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface HoldingRow {
  id: string;
  accountId: string;
  securityId: string;
  asOf: string;
  shares: number | null;
  value: number;
  costBasis: number | null;
  role: string | null;
  createdAt: string;
}

export interface AccountRow {
  id: string;
  type: string;
  owner: string | null;
  institution: string | null;
  balance: number;
  lastUpdated: string | null;
}

export interface HoldingsData {
  securities: SecurityRow[];
  holdings: HoldingRow[];
  accounts: AccountRow[];
  targets: InvestmentTargets;
  /** Use each account's latest snapshot on or before this date; default: the latest of all */
  asOf?: string;
}

export interface Flag {
  level: "warn" | "info";
  code: "band" | "play_cap" | "single_stock" | "remove" | "watch" | "no_class" | "fee" | "no_fee" | "idle_cash" | "stale";
  message: string;
  symbol?: string;
  accountId?: string;
}

const round = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);
const p1 = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function accountLabel(a: Pick<AccountRow, "type" | "owner" | "institution"> | undefined): string {
  if (!a) return "Unknown account";
  return [a.institution, a.type].filter(Boolean).join(" ") + (a.owner ? ` (${a.owner})` : "");
}

/** Each account's rows on its latest snapshot date (on or before asOf) */
function latestSnapshots(holdings: HoldingRow[], asOf?: string): Map<string, { asOf: string; rows: HoldingRow[] }> {
  const latestDate = new Map<string, string>();
  for (const h of holdings) {
    if (asOf && h.asOf > asOf) continue;
    const cur = latestDate.get(h.accountId);
    if (!cur || h.asOf > cur) latestDate.set(h.accountId, h.asOf);
  }
  const out = new Map<string, { asOf: string; rows: HoldingRow[] }>();
  for (const [accountId, date] of latestDate) out.set(accountId, { asOf: date, rows: [] });
  for (const h of holdings) {
    const snap = out.get(h.accountId);
    if (snap && h.asOf === snap.asOf) snap.rows.push(h);
  }
  return out;
}

function classTarget(cls: string, t: InvestmentTargets): number | null {
  if (cls === "us_stock") return t.usPct;
  if (cls === "intl_stock") return t.intlPct;
  if (cls === "bond") return t.bondPct;
  return null;
}

/** Everything for the Investments page and the MCP holdings tool */
export function holdingsOverview(data: HoldingsData) {
  const { targets } = data;
  const secById = new Map(data.securities.map((s) => [s.id, s]));
  const acctById = new Map(data.accounts.map((a) => [a.id, a]));
  const snaps = latestSnapshots(data.holdings, data.asOf);

  const datesByAccount = new Map<string, Set<string>>();
  for (const h of data.holdings) {
    if (!datesByAccount.has(h.accountId)) datesByAccount.set(h.accountId, new Set());
    datesByAccount.get(h.accountId)!.add(h.asOf);
  }

  // ── Per account ──
  const accounts = [...snaps.entries()].map(([accountId, snap]) => {
    const acct = acctById.get(accountId);
    const total = snap.rows.reduce((s, h) => s + h.value, 0);
    const rows = snap.rows
      .map((h) => {
        const sec = secById.get(h.securityId);
        return {
          holdingId: h.id,
          securityId: h.securityId,
          symbol: sec?.symbol ?? "?",
          name: sec?.name ?? null,
          kind: sec?.kind ?? "other",
          assetClass: sec?.assetClass ?? "other",
          role: (h.role ?? sec?.role ?? "core") as string,
          status: sec?.status ?? "keep",
          expenseRatio: sec?.expenseRatio ?? null,
          shares: h.shares,
          value: round(h.value),
          costBasis: h.costBasis,
          gain: h.costBasis != null ? round(h.value - h.costBasis) : null,
          pctOfAccount: pct(h.value, total),
        };
      })
      .sort((a, b) => b.value - a.value);
    return {
      accountId,
      label: accountLabel(acct),
      type: acct?.type ?? null,
      owner: acct?.owner ?? null,
      institution: acct?.institution ?? null,
      asOf: snap.asOf,
      total: round(total),
      balance: acct?.balance ?? null,
      balanceUpdated: acct?.lastUpdated ?? null,
      snapshotDates: [...(datesByAccount.get(accountId) ?? [])].sort().reverse(),
      rows,
    };
  });
  accounts.sort((a, b) => b.total - a.total);

  const allRows = accounts.flatMap((a) => a.rows.map((r) => ({ ...r, accountId: a.accountId, accountLabel: a.label })));
  const total = allRows.reduce((s, r) => s + r.value, 0);

  // ── Mix vs target ──
  const classValue = new Map<string, number>();
  for (const r of allRows) classValue.set(r.assetClass, (classValue.get(r.assetClass) ?? 0) + r.value);
  const byClass = ASSET_CLASSES.filter((c) => (classValue.get(c) ?? 0) !== 0 || (classTarget(c, targets) ?? 0) > 0).map((c) => {
    const value = classValue.get(c) ?? 0;
    const share = pct(value, total);
    const target = classTarget(c, targets);
    const low = target == null ? null : Math.max(0, target - targets.bandPts);
    const high = target == null ? null : Math.min(100, target + targets.bandPts);
    const state = target == null || total === 0 ? null : share < low! ? "low" : share > high! ? "high" : "ok";
    return { assetClass: c, label: ASSET_CLASS_LABELS[c], value: round(value), pct: share, targetPct: target, low, high, state };
  });

  // ── Core vs play ──
  const play = allRows.filter((r) => r.role === "play").reduce((s, r) => s + r.value, 0);
  const playCap = (total * targets.playCapPct) / 100;

  // ── Per security, across accounts ──
  const secTotals = new Map<string, { value: number; accounts: Set<string>; roles: Set<string> }>();
  for (const r of allRows) {
    const cur = secTotals.get(r.securityId) ?? { value: 0, accounts: new Set<string>(), roles: new Set<string>() };
    cur.value += r.value;
    cur.accounts.add(r.accountLabel);
    cur.roles.add(r.role);
    secTotals.set(r.securityId, cur);
  }
  const securities = data.securities
    .map((s) => {
      const held = secTotals.get(s.id);
      return {
        ...s,
        held: !!held,
        value: round(held?.value ?? 0),
        pct: pct(held?.value ?? 0, total),
        accounts: held ? [...held.accounts] : [],
        heldAs: held ? [...held.roles] : [],
      };
    })
    .sort((a, b) => b.value - a.value || a.symbol.localeCompare(b.symbol));

  // ── Fees ──
  const withFee = allRows.filter((r) => r.expenseRatio != null);
  const feeBase = withFee.reduce((s, r) => s + r.value, 0);
  const yearlyFees = withFee.reduce((s, r) => s + (r.value * (r.expenseRatio as number)) / 100, 0);
  const fees = {
    // Percent a year, like the expense ratios: 0.03 = 0.03%
    blendedPct: feeBase > 0 ? Math.round((yearlyFees / feeBase) * 100 * 10000) / 10000 : null,
    yearlyDollars: round(yearlyFees),
    coveredValue: round(feeBase),
    fundsMissingRatio: [...new Set(allRows.filter((r) => r.kind === "fund" && r.expenseRatio == null).map((r) => r.symbol))],
  };

  // ── Flags ──
  const flags: Flag[] = [];
  for (const c of byClass) {
    if (c.state === "low" || c.state === "high") {
      flags.push({
        level: "warn",
        code: "band",
        message: `${c.label} are ${p1(c.pct)}, ${c.state === "low" ? "below" : "above"} the ${c.low} to ${c.high}% band. New money goes to the low side first.`,
      });
    }
  }
  if (total > 0) {
    const playPct = pct(play, total);
    if (play > playCap) {
      flags.push({ level: "warn", code: "play_cap", message: `Play money is ${p1(playPct)} of investments, over the ${targets.playCapPct}% cap.` });
    } else if (play > playCap * 0.8) {
      flags.push({ level: "info", code: "play_cap", message: `Play money is ${p1(playPct)} of investments, close to the ${targets.playCapPct}% cap.` });
    }
  }
  for (const s of securities) {
    if (!s.held) continue;
    if (s.kind === "stock" && s.pct > targets.singleStockPct) {
      flags.push({ level: "warn", code: "single_stock", symbol: s.symbol, message: `${s.symbol} is ${p1(s.pct)} of investments, over the ${targets.singleStockPct}% line for one stock.` });
    }
    if (s.status === "remove") {
      flags.push({ level: "warn", code: "remove", symbol: s.symbol, message: `${s.symbol} is marked remove but is still held (${usd(s.value)} in ${s.accounts.join(", ")}).` });
    } else if (s.status === "watch") {
      flags.push({ level: "info", code: "watch", symbol: s.symbol, message: `${s.symbol} is on the watch list${s.why ? `: ${s.why}` : "."}` });
    }
    if (s.assetClass === "other") {
      flags.push({ level: "info", code: "no_class", symbol: s.symbol, message: `Set an asset class for ${s.symbol} so it counts in the mix.` });
    }
    if (s.kind === "fund" && s.expenseRatio != null && s.expenseRatio > targets.feeWarnPct) {
      flags.push({ level: "warn", code: "fee", symbol: s.symbol, message: `${s.symbol} costs ${s.expenseRatio}% a year, over the ${targets.feeWarnPct}% line.` });
    }
    if (s.kind === "fund" && s.expenseRatio == null) {
      flags.push({ level: "info", code: "no_fee", symbol: s.symbol, message: `${s.symbol} has no expense ratio yet. Look it up on the fund's page.` });
    }
  }
  for (const a of accounts) {
    const idle = a.rows.filter((r) => r.assetClass === "cash" && r.role === "core").reduce((s, r) => s + r.value, 0);
    if (idle > targets.idleCash) {
      flags.push({ level: "info", code: "idle_cash", accountId: a.accountId, message: `${a.label} has ${usd(idle)} of cash. The plan invests idle cash over ${usd(targets.idleCash)} within 30 days.` });
    }
  }
  const newest = accounts.reduce((m, a) => (a.asOf > m ? a.asOf : m), "");
  for (const a of accounts) {
    const days = (Date.parse(newest) - Date.parse(a.asOf)) / 86_400_000;
    if (days > 45) {
      flags.push({ level: "info", code: "stale", accountId: a.accountId, message: `${a.label}'s latest snapshot is from ${a.asOf}, ${Math.round(days)} days older than the newest.` });
    }
  }

  // ── History: the household on each snapshot date, using each account's latest snapshot up to that date ──
  const dates = [...new Set(data.holdings.filter((h) => !data.asOf || h.asOf <= data.asOf).map((h) => h.asOf))].sort();
  const history = dates.map((d) => {
    const s = latestSnapshots(data.holdings, d);
    let t = 0, us = 0, intl = 0, p = 0;
    for (const { rows } of s.values()) {
      for (const h of rows) {
        const sec = secById.get(h.securityId);
        t += h.value;
        if (sec?.assetClass === "us_stock") us += h.value;
        if (sec?.assetClass === "intl_stock") intl += h.value;
        if ((h.role ?? sec?.role) === "play") p += h.value;
      }
    }
    return { asOf: d, total: round(t), usPct: pct(us, t), intlPct: pct(intl, t), play: round(p) };
  });

  return {
    asOf: newest || null,
    targets,
    total: round(total),
    byClass,
    core: round(total - play),
    play: round(play),
    playPct: pct(play, total),
    playCap: round(playCap),
    playRoom: round(playCap - play),
    fees,
    flags: flags.sort((a, b) => (a.level === b.level ? 0 : a.level === "warn" ? -1 : 1)),
    accounts,
    securities,
    history,
  };
}

export type HoldingsOverview = ReturnType<typeof holdingsOverview>;
