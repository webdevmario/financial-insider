import { Fragment } from "react";
import { fmtDate, fmtP, moLabel } from "../../lib/formatters";
import type { RecurringCharge, TxnKind } from "../../types";

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

export const STATUS_BADGE: Record<RecurringCharge["status"], string> = {
  active: "bg-green-dim text-green",
  new: "bg-accent/[0.12] text-accent",
  late: "bg-amber-dim text-amber",
  stopped: "bg-white/[0.06] text-text-dim",
};

export const STATUS_LABEL: Record<RecurringCharge["status"], string> = {
  active: "Active",
  new: "New",
  late: "Late",
  stopped: "Stopped?",
};

export const CADENCE_LABEL: Record<RecurringCharge["cadence"], string> = {
  weekly: "Weekly",
  biweekly: "Every 2 wks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Yearly",
};

export function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-2xl text-[10px] font-semibold whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}

export function Card({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-5 max-md:p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
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

interface TxnRow {
  id: string;
  date: string;
  description: string;
  amount: number;
}

/**
 * Date · description · amount in columns that line up from row to row: one
 * grid shared by every row (subgrid), so each column is as wide as its widest
 * cell. Long descriptions truncate; amounts are right-aligned tabular figures.
 * byMonth adds a header per month with its subtotal under the amount column.
 */
export function TxnRows({ rows, compact, byMonth }: { rows: TxnRow[]; compact?: boolean; byMonth?: boolean }) {
  const subtotals = new Map<string, number>();
  if (byMonth) for (const t of rows) subtotals.set(t.date.slice(0, 7), (subtotals.get(t.date.slice(0, 7)) || 0) + t.amount);
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 tabular-nums">
      {rows.map((t, i) => {
        const month = t.date.slice(0, 7);
        const newMonth = byMonth && month !== rows[i - 1]?.date.slice(0, 7);
        return (
          <Fragment key={t.id}>
            {newMonth && (
              <div className={`grid grid-cols-subgrid col-span-3 items-baseline text-[11px] font-semibold uppercase tracking-wider text-text-muted pb-1 border-b border-border ${i ? "pt-3" : ""}`}>
                <span className="col-span-2">{moLabel(month)}</span>
                <span className="font-mono text-right normal-case tracking-normal text-text-dim">{fmtP(subtotals.get(month)!)}</span>
              </div>
            )}
            <div
              className={`grid grid-cols-subgrid col-span-3 items-baseline ${
                compact ? "mt-1" : "text-xs py-1.5 border-b border-border/30 last:border-0"
              }`}
            >
              <span className="text-text-muted whitespace-nowrap">{fmtDate(t.date)}</span>
              <span className="font-mono truncate" title={t.description}>{t.description}</span>
              <span className={`font-mono text-right whitespace-nowrap ${t.amount > 0 ? "text-green" : ""}`}>{fmtP(t.amount)}</span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
