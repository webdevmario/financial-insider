import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmt, fmtP, fmtDate } from "../../lib/formatters";
import { billAmount, isActiveBill } from "../../lib/billing";
import { goalProgress, sortGoals } from "../../lib/goals";
import StatCard from "../layout/StatCard";
import YearOverYear from "./YearOverYear";
import type { Account, Goal, Subscription, YearOverYear as YoyData } from "../../types";

const ASSET_GROUPS: Record<string, string[]> = {
  Investments: ["401k", "Roth 401k", "IRA", "Roth IRA", "Rollover IRA", "Brokerage", "Crypto", "IUL"],
  Cash: ["Checking", "Savings", "HSA"],
  Property: ["Home Equity", "Vehicle"],
};
const GROUP_COLORS: Record<string, string> = {
  Investments: "#a78bfa",
  Cash: "#34d399",
  Property: "#6366f1",
  Other: "#64748b",
};

function getGroup(type: string): string {
  for (const [g, types] of Object.entries(ASSET_GROUPS)) {
    if (types.includes(type)) return g;
  }
  return "Other";
}

function monthlyEquiv(s: Subscription): number {
  const my = billAmount(s) / (s.splitBy || 1);
  if (s.frequency === "monthly") return my;
  if (s.frequency === "quarterly") return my / 3;
  return my / 12;
}

export default function DashboardView({ onOpenGoals }: { onOpenGoals: () => void }) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ netWorth: 0, income: 0, monthlyBills: 0 });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  // Needs imported statements; the Dashboard works without it
  const [yoy, setYoy] = useState<YoyData | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.dashboard.summary().then(setSummary).catch(() => {}),
      api.accounts.list().then(setAccounts).catch(() => {}),
      api.subscriptions.list().then(setSubs).catch(() => {}),
      api.goals.list().then(setGoals).catch(() => {}),
      api.transactions.yearOverYear().then(setYoy).catch(() => setYoy(null)),
    ]).finally(() => setLoading(false));
  }, []);

  // Asset breakdown by group
  const groupTotals: Record<string, number> = {};
  const groupTypes: Record<string, Set<string>> = {};
  accounts.forEach((a) => {
    const g = getGroup(a.type);
    groupTotals[g] = (groupTotals[g] || 0) + (a.balance || 0);
    if (!groupTypes[g]) groupTypes[g] = new Set();
    groupTypes[g].add(a.type);
  });
  const totalAssets = Object.values(groupTotals).reduce((s, v) => s + v, 0);

  // Top bills
  const activeSubs = subs.filter(isActiveBill);
  const topBills = [...activeSubs]
    .map((s) => ({ ...s, me: monthlyEquiv(s) }))
    .sort((a, b) => b.me - a.me)
    .slice(0, 6);

  // Top in-progress goals, by priority
  const topGoals = sortGoals(goals.filter((g) => !goalProgress(g).done), "priority").slice(0, 4);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="w-7 h-7 border-2 border-border border-t-accent rounded-full animate-spin" />
        <span className="text-sm text-text-muted">Loading…</span>
      </div>
    );
  }

  return (
    <div>
      {/* Stat cards */}
      <div className="grid grid-cols-3 max-md:grid-cols-1 gap-5 mb-6">
        <StatCard label="Net Worth" value={fmt(summary.netWorth)} color="blue" />
        <StatCard label="Monthly Income" value={fmt(summary.income)} color="green" />
        <StatCard label="Monthly Bills" value={fmt(summary.monthlyBills)} color="amber" />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-5">
        {/* Asset Breakdown */}
        <div className="bg-bg-card border border-border rounded-xl p-6 hover:border-[#363a50] transition-colors">
          <div className="text-[14px] font-semibold uppercase tracking-wider text-text-dim mb-5">
            Asset Breakdown
          </div>
          {accounts.length === 0 ? (
            <div className="text-center py-8 text-text-dim text-sm">Add assets to see breakdown</div>
          ) : (
            Object.entries(groupTotals)
              .sort((a, b) => b[1] - a[1])
              .map(([g, v]) => (
                <div key={g} className="flex items-center gap-3 py-2">
                  <div
                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ background: GROUP_COLORS[g] || "#64748b" }}
                  />
                  <span className="flex-1 text-sm flex items-center gap-1.5">
                    {g}
                    <span className="relative group">
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border-[1.5px] border-text-muted text-text-muted text-[9px] font-bold cursor-default hover:border-accent hover:text-accent transition-all">
                        i
                      </span>
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 bg-[#1e2130] border border-border text-text-dim text-xs px-3 py-2.5 rounded-lg min-w-[140px] opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-[0_8px_24px_rgba(0,0,0,0.4)] z-20 leading-relaxed">
                        {[...(groupTypes[g] || [])].sort().join(", ")}
                      </span>
                    </span>
                  </span>
                  <span className="font-mono text-[13px]">{fmt(v)}</span>
                  <span className="text-xs text-text-muted w-10 text-right">
                    {totalAssets > 0 ? ((v / totalAssets) * 100).toFixed(0) : 0}%
                  </span>
                </div>
              ))
          )}
        </div>

        {/* Top Bills */}
        <div className="bg-bg-card border border-border rounded-xl p-6 hover:border-[#363a50] transition-colors">
          <div className="text-[14px] font-semibold uppercase tracking-wider text-text-dim mb-5">
            Top Bills
          </div>
          {activeSubs.length === 0 ? (
            <div className="text-center py-8 text-text-dim text-sm">Add bills to see top costs</div>
          ) : (
            topBills.map((s) => (
              <div key={s.id} className="flex items-center gap-3 py-2">
                <span className="flex-1 text-sm">{s.name}</span>
                <span className="font-mono text-[13px]">{fmtP(s.me)}/mo</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Goals */}
      {topGoals.length > 0 && (
        <button
          type="button"
          onClick={onOpenGoals}
          className="block w-full text-left mt-5 bg-bg-card border border-border rounded-xl p-6 hover:border-[#363a50] transition-colors"
        >
          <div className="flex items-center justify-between mb-5">
            <span className="text-[14px] font-semibold uppercase tracking-wider text-text-dim">Goals</span>
            <span className="text-[11px] text-accent opacity-70">View all ›</span>
          </div>
          <div className="grid grid-cols-2 max-md:grid-cols-1 gap-x-8 gap-y-4">
            {topGoals.map((g) => {
              const p = goalProgress(g);
              return (
                <div key={g.id}>
                  <div className="flex items-center justify-between gap-3 text-sm mb-1.5">
                    <span className="truncate">{g.name}</span>
                    <span className="font-mono text-[13px] shrink-0">
                      {p.hasTarget ? (
                        <>
                          {p.pct.toFixed(0)}%
                          <span className="text-text-muted"> of {fmt(g.targetAmount)}</span>
                        </>
                      ) : (
                        <span className="text-text-muted">Amount not set</span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        p.status === "overdue" ? "bg-red" : p.status === "behind" ? "bg-amber" : "bg-accent"
                      }`}
                      style={{ width: `${p.pct}%` }}
                    />
                  </div>
                  {g.deadline && (
                    <div className="text-[11px] text-text-muted mt-1">Due {fmtDate(g.deadline)}</div>
                  )}
                </div>
              );
            })}
          </div>
        </button>
      )}

      {yoy && <YearOverYear data={yoy} />}
    </div>
  );
}