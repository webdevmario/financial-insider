import type { Goal, GoalPriority } from "../types";

export const PRIORITY_ORDER: Record<GoalPriority, number> = { high: 0, medium: 1, low: 2 };

export const PRIORITY_LABELS: Record<GoalPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const PRIORITY_BADGE: Record<GoalPriority, string> = {
  high: "bg-red-dim text-red",
  medium: "bg-amber-dim text-amber",
  low: "bg-accent-glow text-accent",
};

export const PRIORITY_DOT: Record<GoalPriority, string> = {
  high: "bg-red",
  medium: "bg-amber",
  low: "bg-accent",
};

export type GoalStatus = "done" | "overdue" | "behind" | "on-track" | "no-deadline";

export const STATUS_LABELS: Record<GoalStatus, string> = {
  done: "Reached",
  overdue: "Past deadline",
  behind: "Behind pace",
  "on-track": "On track",
  "no-deadline": "No deadline",
};

export const STATUS_STYLES: Record<GoalStatus, string> = {
  done: "bg-green-dim text-green",
  overdue: "bg-red-dim text-red",
  behind: "bg-amber-dim text-amber",
  "on-track": "bg-green-dim text-green",
  "no-deadline": "bg-white/[0.06] text-text-dim",
};

const DAY = 86_400_000;
const AVG_MONTH_DAYS = 30.44;

function dayStart(ds: string): number {
  return new Date(ds + "T00:00:00").getTime();
}

export interface GoalProgress {
  /** 0–100, capped */
  pct: number;
  remaining: number;
  done: boolean;
  /** Whole days until the deadline (negative once it has passed) */
  daysLeft: number | null;
  /** Amount to set aside each month to hit the deadline */
  perMonth: number | null;
  status: GoalStatus;
}

export function goalProgress(g: Goal, now = new Date()): GoalProgress {
  const target = g.targetAmount || 0;
  const saved = g.savedAmount || 0;
  const done = target > 0 && saved >= target;
  const pct = target > 0 ? Math.min(100, Math.max(0, (saved / target) * 100)) : 0;
  const remaining = Math.max(0, target - saved);

  if (!g.deadline) {
    return { pct, remaining, done, daysLeft: null, perMonth: null, status: done ? "done" : "no-deadline" };
  }

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const due = dayStart(g.deadline);
  const daysLeft = Math.round((due - today.getTime()) / DAY);

  if (done) return { pct, remaining, done, daysLeft, perMonth: null, status: "done" };
  if (daysLeft < 0) return { pct, remaining, done, daysLeft, perMonth: null, status: "overdue" };

  // Less than a month left means the whole remainder is due "this month"
  const perMonth = remaining / Math.max(1, daysLeft / AVG_MONTH_DAYS);

  // Compare progress to how much of the time window has elapsed since the goal was created
  const start = dayStart(g.createdAt);
  const span = due - start;
  const elapsed = span > 0 ? Math.min(1, Math.max(0, (today.getTime() - start) / span)) : 1;
  const status: GoalStatus = pct + 5 >= elapsed * 100 ? "on-track" : "behind";

  return { pct, remaining, done, daysLeft, perMonth, status };
}

/** "12 days left", "3 mo left", "1.5 yr left", "5 days ago" */
export function timeLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return "Due today";
  if (daysLeft < 0) {
    const d = -daysLeft;
    return d === 1 ? "1 day ago" : `${d} days ago`;
  }
  if (daysLeft < 60) return daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
  const months = daysLeft / AVG_MONTH_DAYS;
  if (months < 24) return `${Math.round(months)} mo left`;
  return `${(months / 12).toFixed(1)} yr left`;
}

export type GoalSort = "priority" | "deadline" | "progress" | "name";

/** Priority first, then soonest deadline (none last), then name */
export function comparePriority(a: Goal, b: Goal): number {
  return (
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
    compareDeadline(a, b)
  );
}

export function compareDeadline(a: Goal, b: Goal): number {
  if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline) || a.name.localeCompare(b.name);
  if (a.deadline) return -1;
  if (b.deadline) return 1;
  return a.name.localeCompare(b.name);
}

export function sortGoals(goals: Goal[], sort: GoalSort): Goal[] {
  const list = [...goals];
  switch (sort) {
    case "priority":
      return list.sort(comparePriority);
    case "deadline":
      return list.sort(compareDeadline);
    case "progress":
      return list.sort((a, b) => goalProgress(b).pct - goalProgress(a).pct || comparePriority(a, b));
    case "name":
      return list.sort((a, b) => a.name.localeCompare(b.name));
  }
}
