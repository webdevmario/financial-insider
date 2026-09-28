import type { Subscription } from "../types";

const INCREMENT_MONTHS = { monthly: 1, quarterly: 3, annual: 12 } as const;

/**
 * Given a stored nextCharge date (YYYY-MM-DD) and a frequency,
 * advance the date forward until it's >= today.
 * This keeps the "next charge" fresh without needing manual updates.
 *
 * Steps are always taken from the original day-of-month and clamped to the
 * month's length, so a bill on the 31st lands on Feb 28 → Mar 31, not Mar 3.
 */
export function computeEffectiveNextCharge(
  nextCharge: string | null,
  frequency: Subscription["frequency"]
): string | null {
  if (!nextCharge) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [y, m, d] = nextCharge.split("-").map(Number);
  const increment = INCREMENT_MONTHS[frequency] ?? 1;

  let charge = new Date(y, m - 1, d);
  for (let step = 1; charge < today; step++) {
    const monthIndex = m - 1 + step * increment;
    const lastDay = new Date(y, monthIndex + 1, 0).getDate();
    charge = new Date(y, monthIndex, Math.min(d, lastDay));
  }

  const ny = charge.getFullYear();
  const nm = String(charge.getMonth() + 1).padStart(2, "0");
  const nd = String(charge.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}
