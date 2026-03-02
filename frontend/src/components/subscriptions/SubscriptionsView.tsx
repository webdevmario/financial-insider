import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { fmtP } from "../../lib/formatters";
import StatCard from "../layout/StatCard";
import SubscriptionForm from "./SubscriptionForm";
import type { Subscription } from "../../types";

interface SubscriptionsViewProps {
  onToast: (msg: string, err?: boolean) => void;
}

export default function SubscriptionsView({ onToast }: SubscriptionsViewProps) {
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [catFilter, setCatFilter] = useState("");
  const [freqFilter, setFreqFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(() => {
    return api.subscriptions.list().then(setSubs).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  function openNew() { setEditing(null); setFormOpen(true); }
  function openEdit(s: Subscription) { setEditing(s); setFormOpen(true); }

  // Calculations
  let mT = 0, qT = 0, aT = 0;
  subs.forEach((s) => {
    const my = s.amount / (s.splitBy || 1);
    if (s.frequency === "monthly") mT += my;
    else if (s.frequency === "quarterly") qT += my / 3;
    else if (s.frequency === "annual") aT += my / 12;
  });

  // Pay period breakdown
  let pp1 = 0, pp2 = 0, pp1c = 0, pp2c = 0;
  subs.forEach((s) => {
    const my = s.amount / (s.splitBy || 1);
    const me = s.frequency === "monthly" ? my : s.frequency === "quarterly" ? my / 3 : my / 12;
    if (!s.nextCharge) return;
    const day = parseInt(s.nextCharge.split("-")[2]);
    if (day <= 15) { pp1 += me; pp1c++; } else { pp2 += me; pp2c++; }
  });

  // Categories for filter
  const categories = [...new Set(subs.map((s) => s.category || "General"))].sort();

  // Apply filters
  let filtered = subs;
  if (catFilter) filtered = filtered.filter((s) => (s.category || "General") === catFilter);
  if (freqFilter) filtered = filtered.filter((s) => s.frequency === freqFilter);
  if (statusFilter) filtered = filtered.filter((s) => (s.status || "") === statusFilter);
  filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));

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
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h2 className="text-[22px] font-semibold">Bills</h2>
        <button className="btn btn-primary" onClick={openNew}>+ Add Bill</button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 max-md:grid-cols-1 gap-5 mb-6">
        <StatCard label="Monthly Total" value={fmtP(mT)} color="blue" />
        <StatCard label="Quarterly (Mo. Equiv.)" value={fmtP(qT)} color="amber" />
        <StatCard label="Annual (Mo. Equiv.)" value={fmtP(aT)} color="green" />
      </div>

      {/* Pay Period Breakdown */}
      <div className="bg-bg-card border border-border rounded-xl px-6 py-5 mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">
          Pay Period Breakdown
        </div>
        <div className="flex gap-4 max-md:flex-col">
          <div className="flex-1 bg-bg-input rounded-lg px-4 py-3.5">
            <div className="text-[11px] text-text-muted mb-1">1st — 15th</div>
            <div className="font-mono text-xl font-semibold">{fmtP(pp1)}</div>
            <div className="text-[11px] text-text-muted mt-0.5">{pp1c} item{pp1c !== 1 ? "s" : ""}</div>
          </div>
          <div className="flex-1 bg-bg-input rounded-lg px-4 py-3.5">
            <div className="text-[11px] text-text-muted mb-1">16th — 31st</div>
            <div className="font-mono text-xl font-semibold">{fmtP(pp2)}</div>
            <div className="text-[11px] text-text-muted mt-0.5">{pp2c} item{pp2c !== 1 ? "s" : ""}</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 items-center mb-3 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Filter by</span>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="!w-auto !text-xs !py-1 !px-2.5"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={freqFilter}
          onChange={(e) => setFreqFilter(e.target.value)}
          className="!w-auto !text-xs !py-1 !px-2.5"
        >
          <option value="">All Frequencies</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="annual">Annual</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="!w-auto !text-xs !py-1 !px-2.5"
        >
          <option value="">All Statuses</option>
          <option value="essential">Essential</option>
          <option value="review">Under Review</option>
        </select>
      </div>

      {/* List */}
      <div className="bg-bg-card border border-border rounded-xl">
        {/* Header - desktop only */}
        <div className="hidden md:grid grid-cols-[1fr_120px_100px_110px_32px] items-center px-4 py-2.5 border-b border-border text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          <span>Service</span>
          <span>Category</span>
          <span>Frequency</span>
          <span className="text-right">Amount</span>
          <span />
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-text-dim">
            <div className="text-4xl mb-3 opacity-40">🔄</div>
            <p className="text-sm">{subs.length === 0 ? "No bills yet" : "No bills match filters"}</p>
          </div>
        ) : (
          filtered.map((s) => {
            const isSplit = s.splitBy > 1;
            const myCost = s.amount / (s.splitBy || 1);
            const freqClass =
              s.frequency === "monthly"
                ? "bg-accent-glow text-accent"
                : s.frequency === "quarterly"
                  ? "bg-amber-dim text-amber"
                  : "bg-green-dim text-green";

            return (
              <div
                key={s.id}
                className="grid grid-cols-[1fr_120px_100px_110px_32px] max-md:flex max-md:gap-2 items-center px-4 py-3 border-b border-border/40 text-sm cursor-pointer hover:bg-accent/[0.04] transition-all"
                onClick={() => openEdit(s)}
              >
                <div className="min-w-0">
                  <div className="flex items-center flex-wrap gap-1">
                    <span>{s.name}</span>
                    {isSplit && (
                      <span className="text-[10px] text-cyan bg-cyan/10 px-1.5 py-0.5 rounded-xl">
                        Shared
                      </span>
                    )}
                    {s.status === "review" && (
                      <span title="Under review" className="text-[13px] cursor-default">⚠️</span>
                    )}
                  </div>
                  {s.notes && (
                    <div className="text-[11px] text-text-muted mt-1 truncate max-w-[300px]">
                      {s.notes}
                    </div>
                  )}
                </div>
                <span className="max-md:hidden">
                  <span className="inline-flex px-2.5 py-0.5 rounded-2xl text-[11px] font-semibold bg-purple-dim text-purple">
                    {s.category || "General"}
                  </span>
                </span>
                <span className="max-md:hidden">
                  <span className={`inline-flex px-2.5 py-0.5 rounded-2xl text-[11px] font-semibold ${freqClass}`}>
                    {s.frequency}
                  </span>
                </span>
                <span className="font-mono text-right max-md:ml-auto max-md:flex-shrink-0">
                  {fmtP(myCost)}
                </span>
                <span className="text-text-muted text-lg opacity-60 text-right">›</span>
              </div>
            );
          })
        )}
      </div>

      <SubscriptionForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={load}
        onToast={onToast}
        subscription={editing}
      />
    </div>
  );
}