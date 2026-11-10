import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { fmt, fmtP, fmtDate } from "../../lib/formatters";
import {
  goalProgress, sortGoals, timeLeftLabel,
  PRIORITY_BADGE, PRIORITY_DOT, PRIORITY_LABELS, STATUS_LABELS, STATUS_STYLES,
  type GoalSort,
} from "../../lib/goals";
import StatCard from "../layout/StatCard";
import LoadingState from "../layout/LoadingState";
import GoalForm from "./GoalForm";
import ContributionForm from "./ContributionForm";
import type { Goal, GoalPriority } from "../../types";

interface GoalsViewProps {
  onToast: (msg: string, err?: boolean) => void;
}

type Show = "active" | "reached" | "all";

const SORT_KEY = "goals.sort";
const SHOW_KEY = "goals.show";

function stored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: preference just won't stick
  }
}

export default function GoalsView({ onToast }: GoalsViewProps) {
  const [loading, setLoading] = useState(true);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [contributing, setContributing] = useState<Goal | null>(null);
  const [sort, setSort] = useState<GoalSort>(() =>
    stored(SORT_KEY, "priority", ["priority", "deadline", "progress", "name"] as const)
  );
  const [show, setShow] = useState<Show>(() => stored(SHOW_KEY, "active", ["active", "reached", "all"] as const));

  const load = useCallback(() => {
    return api.goals.list().then(setGoals).catch((err) => {
      onToast(err instanceof Error ? err.message : "Failed to load goals", true);
    });
  }, [onToast]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  function openNew() { setEditing(null); setFormOpen(true); }
  function openEdit(g: Goal) { setEditing(g); setFormOpen(true); }

  if (loading) return <LoadingState />;

  // Totals cover goals still in progress
  const active = goals.filter((g) => !goalProgress(g).done);
  const reachedCount = goals.length - active.length;
  const totalSaved = goals.reduce((s, g) => s + (g.savedAmount || 0), 0);
  const stillNeeded = active.reduce((s, g) => s + goalProgress(g).remaining, 0);
  const monthlyNeeded = active.reduce((s, g) => s + (goalProgress(g).perMonth || 0), 0);

  const visible = goals.filter((g) => {
    const done = goalProgress(g).done;
    return show === "all" || (show === "reached" ? done : !done);
  });
  const sorted = sortGoals(visible, sort);

  // When ordered by priority, show a heading per level
  const sections: { priority: GoalPriority | null; items: Goal[] }[] =
    sort === "priority"
      ? (["high", "medium", "low"] as const)
          .map((p) => ({ priority: p, items: sorted.filter((g) => g.priority === p) }))
          .filter((s) => s.items.length)
      : [{ priority: null, items: sorted }];

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h2 className="text-[22px] font-semibold">Goals</h2>
        <button className="btn btn-primary" onClick={openNew}>+ Add Goal</button>
      </div>

      <div className="grid grid-cols-3 max-md:grid-cols-1 gap-5 mb-6">
        <StatCard label="Total Saved" value={fmt(totalSaved)} color="green" />
        <StatCard label="Still Needed" value={fmt(stillNeeded)} color="amber" />
        <StatCard label="Monthly to Stay on Track" value={fmt(monthlyNeeded)} color="blue" />
      </div>

      {goals.length === 0 ? (
        <div className="text-center py-12 text-text-dim">
          <div className="text-4xl mb-3 opacity-40">🎯</div>
          <p className="text-sm mb-1">No goals yet.</p>
          <p className="text-xs text-text-muted mb-4">
            Add something you're saving toward — a trip, a car, an emergency fund.
          </p>
          <button className="btn btn-primary" onClick={openNew}>+ Add First Goal</button>
        </div>
      ) : (
        <>
          <div className="flex gap-2 items-center mb-4 flex-wrap">
            <div className="flex gap-0.5 p-0.5 bg-bg-card border border-border rounded-lg">
              {(["active", "reached", "all"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setShow(s); remember(SHOW_KEY, s); }}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    show === s ? "text-accent bg-accent/[0.1]" : "text-text-dim hover:text-text"
                  }`}
                >
                  {s === "active" ? `Active (${active.length})` : s === "reached" ? `Reached (${reachedCount})` : "All"}
                </button>
              ))}
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted ml-auto">Sort</span>
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value as GoalSort); remember(SORT_KEY, e.target.value); }}
              className="!w-auto !text-xs !py-1 !px-2.5"
            >
              <option value="priority">Priority</option>
              <option value="deadline">Deadline</option>
              <option value="progress">Progress</option>
              <option value="name">Name</option>
            </select>
          </div>

          {sorted.length === 0 ? (
            <div className="text-center py-12 text-text-dim text-sm bg-bg-card border border-border rounded-xl">
              {show === "reached" ? "No goals reached yet — keep going." : "Every goal is reached. 🎉"}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {sections.map((section) => (
                <div key={section.priority ?? "all"}>
                  {section.priority && (
                    <div className="flex items-center gap-2 mb-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[section.priority]}`} />
                      {PRIORITY_LABELS[section.priority]} priority
                      <span className="text-text-muted/70 normal-case tracking-normal font-normal">
                        · {section.items.length}
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">
                    {section.items.map((g) => (
                      <GoalCard
                        key={g.id}
                        goal={g}
                        showPriority={sort !== "priority"}
                        onEdit={() => openEdit(g)}
                        onContribute={() => setContributing(g)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <GoalForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={load}
        onToast={onToast}
        goal={editing}
      />
      <ContributionForm
        open={!!contributing}
        onClose={() => setContributing(null)}
        onSaved={(updated) => setGoals((list) => list.map((g) => (g.id === updated.id ? updated : g)))}
        onToast={onToast}
        goal={contributing}
      />
    </div>
  );
}

function GoalCard({
  goal, showPriority, onEdit, onContribute,
}: {
  goal: Goal;
  showPriority: boolean;
  onEdit: () => void;
  onContribute: () => void;
}) {
  const p = goalProgress(goal);

  return (
    <div
      className="bg-bg-card border border-border rounded-xl p-5 cursor-pointer hover:border-[#363a50] transition-colors"
      onClick={onEdit}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{goal.name}</span>
            {showPriority && (
              <span className={`inline-flex px-2 py-0.5 rounded-2xl text-[10px] font-semibold ${PRIORITY_BADGE[goal.priority]}`}>
                {PRIORITY_LABELS[goal.priority]}
              </span>
            )}
          </div>
          {goal.notes && <div className="text-[11px] text-text-muted mt-1 truncate">{goal.notes}</div>}
        </div>
        <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-2xl text-[10px] font-semibold ${STATUS_STYLES[p.status]}`}>
          {p.done ? "🎉 " : ""}{STATUS_LABELS[p.status]}
        </span>
      </div>

      {p.hasTarget ? (
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <span className="font-mono text-[22px] font-semibold tracking-tight">{p.pct.toFixed(0)}%</span>
          <span className="text-xs text-text-muted">
            <span className="font-mono text-text">{fmtP(goal.savedAmount)}</span> of {fmtP(goal.targetAmount)}
          </span>
        </div>
      ) : (
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <span className="font-mono text-[22px] font-semibold tracking-tight">{goal.savedAmount > 0 ? fmtP(goal.savedAmount) : "—"}</span>
          <span className="text-xs text-text-muted">{goal.savedAmount > 0 ? "saved so far" : "nothing saved yet"}</span>
        </div>
      )}

      {/* No amount yet: an empty dashed track instead of a bar with nothing to measure */}
      <div className={`h-2 rounded-full overflow-hidden mb-3 ${p.hasTarget ? "bg-white/[0.06]" : "border border-dashed border-border"}`}>
        <div
          className={`h-full rounded-full transition-all ${
            p.done ? "bg-green" : p.status === "overdue" ? "bg-red" : p.status === "behind" ? "bg-amber" : "bg-accent"
          }`}
          style={{ width: `${p.pct}%` }}
        />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="text-[11px] text-text-muted leading-relaxed min-w-0">
          {p.done ? (
            <>Reached {fmtDate(goal.completedAt)}</>
          ) : !p.hasTarget ? (
            <>
              Add an amount when you know it
              {goal.deadline && p.daysLeft != null && (
                <>
                  <br />
                  {fmtDate(goal.deadline)} · {timeLeftLabel(p.daysLeft)}
                </>
              )}
            </>
          ) : (
            <>
              {fmtP(p.remaining)} to go
              {goal.deadline && (
                <>
                  <br />
                  {fmtDate(goal.deadline)} · {timeLeftLabel(p.daysLeft!)}
                  {p.perMonth != null && (
                    <> · <span className="text-text-dim font-mono">{fmtP(p.perMonth)}/mo</span></>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <button
          className="btn btn-sm shrink-0"
          onClick={(e) => { e.stopPropagation(); onContribute(); }}
        >
          {p.done ? "Log" : "+ Add"}
        </button>
      </div>
    </div>
  );
}
