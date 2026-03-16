import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../lib/api";
import { fmtP } from "../../lib/formatters";
import StatCard from "../layout/StatCard";
import SubscriptionForm from "./SubscriptionForm";
import type { Subscription } from "../../types";

interface SubscriptionsViewProps {
  onToast: (msg: string, err?: boolean) => void;
}

/**
 * Given a stored nextCharge date (YYYY-MM-DD) and a frequency,
 * advance the date forward until it's >= today.
 * This keeps the "next charge" fresh without needing manual updates.
 */
function computeEffectiveNextCharge(
  nextCharge: string | null,
  frequency: "monthly" | "quarterly" | "annual"
): string | null {
  if (!nextCharge) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [y, m, d] = nextCharge.split("-").map(Number);
  const charge = new Date(y, m - 1, d);
  charge.setHours(0, 0, 0, 0);

  const increment = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;

  // Advance until the charge date is today or in the future
  while (charge < today) {
    charge.setMonth(charge.getMonth() + increment);
  }

  const ny = charge.getFullYear();
  const nm = String(charge.getMonth() + 1).padStart(2, "0");
  const nd = String(charge.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

export default function SubscriptionsView({ onToast }: SubscriptionsViewProps) {
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [catFilter, setCatFilter] = useState("");
  const [freqFilter, setFreqFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [ppPopover, setPpPopover] = useState<"pp1" | "pp2" | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!ppPopover) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPpPopover(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ppPopover]);

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

  // Pay period breakdown with effective dates and itemized lists
  let pp1 = 0, pp2 = 0;
  const pp1Items: { name: string; amount: number; day: number }[] = [];
  const pp2Items: { name: string; amount: number; day: number }[] = [];
  subs.forEach((s) => {
    const my = s.amount / (s.splitBy || 1);
    const me = s.frequency === "monthly" ? my : s.frequency === "quarterly" ? my / 3 : my / 12;
    const effective = computeEffectiveNextCharge(s.nextCharge, s.frequency);
    if (!effective) return;
    const day = parseInt(effective.split("-")[2]);
    if (day <= 15) {
      pp1 += me;
      pp1Items.push({ name: s.name, amount: me, day });
    } else {
      pp2 += me;
      pp2Items.push({ name: s.name, amount: me, day });
    }
  });
  // Sort items by day of month
  pp1Items.sort((a, b) => a.day - b.day);
  pp2Items.sort((a, b) => a.day - b.day);

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

  const renderPopoverItems = (items: { name: string; amount: number; day: number }[]) => (
    <div className="flex flex-col gap-0.5">
      {items.length === 0 ? (
        <div className="text-text-muted text-xs py-1">No bills in this period</div>
      ) : (
        items.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-1.5 text-xs border-b border-border/30 last:border-0">
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-text-muted font-mono text-[10px] w-6 text-right shrink-0">{item.day}th</span>
              <span className="truncate">{item.name}</span>
            </span>
            <span className="font-mono text-green shrink-0">{fmtP(item.amount)}</span>
          </div>
        ))
      )}
    </div>
  );

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
          {/* 1st–15th */}
          <div className="flex-1 relative">
            <button
              type="button"
              className="w-full text-left bg-bg-input rounded-lg px-4 py-3.5 transition-all hover:ring-1 hover:ring-accent/40 focus:ring-1 focus:ring-accent/40 outline-none"
              onClick={() => setPpPopover(ppPopover === "pp1" ? null : "pp1")}
            >
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-text-muted mb-1">1st — 15th</div>
                <span className="text-[10px] text-accent opacity-70">{pp1Items.length > 0 ? "View items ›" : ""}</span>
              </div>
              <div className="font-mono text-xl font-semibold">{fmtP(pp1)}</div>
              <div className="text-[11px] text-text-muted mt-0.5">{pp1Items.length} item{pp1Items.length !== 1 ? "s" : ""}</div>
            </button>
            {ppPopover === "pp1" && (
              <div
                ref={popoverRef}
                className="absolute left-0 right-0 top-full mt-2 z-50 bg-bg-card border border-border rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.5)] p-4 animate-[slideUp_0.15s_ease-out]"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">Bills due 1st — 15th</div>
                {renderPopoverItems(pp1Items)}
              </div>
            )}
          </div>

          {/* 16th–31st */}
          <div className="flex-1 relative">
            <button
              type="button"
              className="w-full text-left bg-bg-input rounded-lg px-4 py-3.5 transition-all hover:ring-1 hover:ring-accent/40 focus:ring-1 focus:ring-accent/40 outline-none"
              onClick={() => setPpPopover(ppPopover === "pp2" ? null : "pp2")}
            >
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-text-muted mb-1">16th — 31st</div>
                <span className="text-[10px] text-accent opacity-70">{pp2Items.length > 0 ? "View items ›" : ""}</span>
              </div>
              <div className="font-mono text-xl font-semibold">{fmtP(pp2)}</div>
              <div className="text-[11px] text-text-muted mt-0.5">{pp2Items.length} item{pp2Items.length !== 1 ? "s" : ""}</div>
            </button>
            {ppPopover === "pp2" && (
              <div
                ref={popoverRef}
                className="absolute left-0 right-0 top-full mt-2 z-50 bg-bg-card border border-border rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.5)] p-4 animate-[slideUp_0.15s_ease-out]"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">Bills due 16th — 31st</div>
                {renderPopoverItems(pp2Items)}
              </div>
            )}
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