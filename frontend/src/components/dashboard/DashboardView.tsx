import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmt, fmtP, fmtDate } from "../../lib/formatters";
import StatCard from "../layout/StatCard";
import type { Account, Subscription } from "../../types";

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
  const my = s.amount / (s.splitBy || 1);
  if (s.frequency === "monthly") return my;
  if (s.frequency === "quarterly") return my / 3;
  return my / 12;
}

export default function DashboardView() {
  const [summary, setSummary] = useState({ netWorth: 0, income: 0, monthlyBills: 0 });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);

  useEffect(() => {
    api.dashboard.summary().then(setSummary).catch(() => {});
    api.accounts.list().then(setAccounts).catch(() => {});
    api.subscriptions.list().then(setSubs).catch(() => {});
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
  const topBills = [...subs]
    .map((s) => ({ ...s, me: monthlyEquiv(s) }))
    .sort((a, b) => b.me - a.me)
    .slice(0, 6);

  // Upcoming non-monthly charges (next 30 days)
  const today = new Date();
  const future = new Date(today);
  future.setDate(future.getDate() + 30);
  const upcoming = subs.filter((s) => {
    if (!s.nextCharge || s.frequency === "monthly") return false;
    const d = new Date(s.nextCharge + "T00:00:00");
    return d >= today && d <= future;
  });

  return (
    <div>
      {/* Stat cards */}
      <div className="grid grid-cols-3 max-md:grid-cols-1 gap-5 mb-6">
        <StatCard label="Net Worth" value={fmt(summary.netWorth)} color="blue" />
        <StatCard label="Monthly Income" value={fmt(summary.income)} color="green" />
        <StatCard label="Monthly Bills" value={fmt(summary.monthlyBills)} color="amber" />
      </div>

      {/* Upcoming callout */}
      {upcoming.length > 0 && (
        <div className="bg-amber-dim border border-amber/20 rounded-xl px-5 py-4 mb-5 flex items-start gap-3">
          <span className="text-lg flex-shrink-0 mt-0.5">⚠️</span>
          <div>
            <div className="text-[13px] font-semibold text-amber mb-1">
              Upcoming Non-Monthly Charges
            </div>
            <div className="text-[13px] text-text-dim leading-relaxed">
              {upcoming.map((s, i) => (
                <span key={s.id}>
                  <strong>{s.name}</strong> — {fmtP(s.amount)} on {fmtDate(s.nextCharge)}
                  {i < upcoming.length - 1 && <br />}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

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
          {subs.length === 0 ? (
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
    </div>
  );
}
