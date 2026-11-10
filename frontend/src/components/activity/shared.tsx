import { Fragment } from "react";
import { fmt, fmtDate, fmtP, moLabel } from "../../lib/formatters";
import type { TxnKind } from "../../types";

// ── Money out vs money in ─────────────────────────────────────────

/**
 * A group's headline amount: what it cost, or, for a group that only
 * brings money in (interest earned, paychecks, cashouts), the green
 * money-in total, so it doesn't read as $0.00
 */
export function money(spent: number, received: number, f: (n: number) => string = fmt): React.ReactNode {
  return spent === 0 && received > 0 ? <span className="text-green">+{f(received)} in</span> : f(spent);
}

/** "+$X in" to sit beside spending when a group has both; skips stray refunds under 1% of the spend */
export function moneyInNote(spent: number, received: number, f: (n: number) => string = fmt): string | null {
  return spent > 0 && received >= 1 && received >= spent * 0.01 ? `+${f(received)} in` : null;
}

export const KIND_LABELS: Record<TxnKind, string> = {
  spend: "Spending",
  income: "Income",
  refund: "Refund",
  transfer: "Transfer (own accounts)",
  fee: "Fee",
  interest: "Interest",
};

export const KIND_BADGE: Record<TxnKind, string> = {
  spend: "",
  income: "bg-green-dim text-green",
  refund: "bg-green-dim text-green",
  transfer: "bg-white/[0.06] text-text-dim",
  fee: "bg-red-dim text-red",
  interest: "bg-red-dim text-red",
};

export function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-2xl text-[10px] font-semibold whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}

/** `actionRow` keeps the header as tall as a small button, so side-by-side cards line up */
export function Card({ title, extra, actionRow, children }: { title: string; extra?: React.ReactNode; actionRow?: boolean; children: React.ReactNode }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-5 max-md:p-4">
      <div className={`flex items-center justify-between gap-3 mb-3 ${actionRow ? "min-h-9" : ""}`}>
        <div className="text-[12px] font-semibold uppercase tracking-wider text-text-muted">{title}</div>
        {extra}
      </div>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-text-muted py-3">{children}</div>;
}

export const MATCH_LABELS: Record<import("../../types").AliasMatch, string> = {
  contains: "Contains",
  starts: "Starts with",
  exact: "Is exactly",
  merchant: "Bank name is",
};

/** Default alias text for a bank description: its start, before store numbers and reference codes */
export function defaultPattern(description: string): string {
  return description.replace(/\s+/g, " ").split(/ #| \d{3,}|\*/)[0].trim().slice(0, 40);
}

/** "Oct 27" this year, "Oct 27, 2025" otherwise: keeps a date column narrow on phones */
export function shortDate(ds: string): string {
  const full = fmtDate(ds);
  return ds.startsWith(String(new Date().getFullYear())) ? full.replace(/, \d{4}$/, "") : full;
}

interface TxnRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  /** Account name: adds an account column (under the description where the list is narrow) */
  account?: string;
  /** Adds a small label beside the description when it isn't spending */
  kind?: TxnKind;
}

/** Column templates, written out in full so Tailwind sees them: [checkbox] date description [account] amount */
const TXN_COLS = {
  plain: "grid-cols-[auto_minmax(0,1fr)_auto]",
  select: "grid-cols-[auto_auto_minmax(0,1fr)_auto]",
  account: "grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_auto_auto]",
  selectAccount: "grid-cols-[auto_auto_minmax(0,1fr)_auto] md:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]",
};

/**
 * Date · description · amount in columns that line up from row to row: one
 * grid shared by every row (subgrid), so each column is as wide as its widest
 * cell. Long descriptions truncate; amounts are right-aligned tabular figures.
 * byMonth adds a header per month with its subtotal under the amount column.
 * select adds a checkbox per row (the whole row toggles it). Rows with an
 * account get an account column from md up; on phones the account (and kind
 * label) sit under the description, which wraps instead of truncating.
 */
export function TxnRows({ rows, compact, byMonth, select }: {
  rows: TxnRow[];
  compact?: boolean;
  byMonth?: boolean;
  select?: { picked: Set<string>; onToggle: (id: string) => void };
}) {
  const subtotals = new Map<string, number>();
  if (byMonth) for (const t of rows) subtotals.set(t.date.slice(0, 7), (subtotals.get(t.date.slice(0, 7)) || 0) + t.amount);
  const withAccount = rows.some((t) => t.account != null);
  const cols = TXN_COLS[select ? (withAccount ? "selectAccount" : "select") : withAccount ? "account" : "plain"];
  return (
    <div className={`grid ${cols} gap-x-3 tabular-nums`}>
      {rows.map((t, i) => {
        const month = t.date.slice(0, 7);
        const newMonth = byMonth && month !== rows[i - 1]?.date.slice(0, 7);
        const kindLabel = t.kind && t.kind !== "spend" ? <Badge className={`${KIND_BADGE[t.kind]} shrink-0`}>{t.kind === "transfer" ? "Transfer" : KIND_LABELS[t.kind]}</Badge> : null;
        const rowClass = `grid grid-cols-subgrid col-span-full items-baseline ${
          compact ? "mt-1" : "text-xs py-1.5 border-b border-border/30 last:border-0"
        }`;
        const cells = (
          <>
            {select && (
              <input
                type="checkbox"
                className="self-start mt-px"
                checked={select.picked.has(t.id)}
                onChange={() => select.onToggle(t.id)}
                aria-label={`Select ${fmtDate(t.date)} ${t.description}`}
              />
            )}
            {withAccount ? (
              <span className="text-text-muted whitespace-nowrap">
                <span className="md:hidden">{shortDate(t.date)}</span>
                <span className="max-md:hidden">{fmtDate(t.date)}</span>
              </span>
            ) : (
              <span className="text-text-muted whitespace-nowrap">{fmtDate(t.date)}</span>
            )}
            {withAccount || kindLabel ? (
              <span className="min-w-0">
                {/* Phones wrap the full description rather than cut it to a few characters */}
                <span className="flex items-baseline gap-1.5 min-w-0">
                  <span className="font-mono truncate max-md:whitespace-normal max-md:break-words" title={t.description}>{t.description}</span>
                  {kindLabel && <span className="max-md:hidden">{kindLabel}</span>}
                </span>
                {/* Account (where it has no column) and, on phones, the kind label */}
                {(t.account != null || kindLabel) && (
                  <span className="flex items-center gap-1.5 min-w-0 mt-0.5 md:hidden">
                    {t.account != null && <span className="text-[10px] text-text-muted truncate" title={t.account}>{t.account}</span>}
                    {kindLabel && <span className="md:hidden">{kindLabel}</span>}
                  </span>
                )}
              </span>
            ) : (
              <span className="font-mono truncate" title={t.description}>{t.description}</span>
            )}
            {withAccount && (
              <span className="text-text-muted whitespace-nowrap max-w-[10rem] truncate max-md:hidden" title={t.account}>{t.account}</span>
            )}
            <span className={`font-mono text-right whitespace-nowrap ${t.amount > 0 ? "text-green" : ""}`}>
              {t.kind && t.amount > 0 ? "+" : ""}{fmtP(t.amount)}
            </span>
          </>
        );
        return (
          <Fragment key={t.id}>
            {newMonth && (
              <div className={`grid grid-cols-subgrid col-span-full items-baseline text-[11px] font-semibold uppercase tracking-wider text-text-muted pb-1 border-b border-border ${i ? "pt-3" : ""}`}>
                <span className="col-[1/-2]">{moLabel(month)}</span>
                <span className="font-mono text-right normal-case tracking-normal text-text-dim">{fmtP(subtotals.get(month)!)}</span>
              </div>
            )}
            {select ? (
              <label className={`${rowClass} cursor-pointer hover:bg-white/[0.02]`}>{cells}</label>
            ) : (
              <div className={rowClass}>{cells}</div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
