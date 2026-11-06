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
