/** Bill states. Paused and cancelled bills stay on the list for their history but aren't expected or counted. */
export const BILL_STATES = ["active", "paused", "cancelled"] as const;
export type BillState = (typeof BILL_STATES)[number];

/** Stored as null for active, so older rows and imports need no change */
export function billState(b: { state?: string | null }): BillState {
  return b.state === "paused" || b.state === "cancelled" ? b.state : "active";
}

export function isActiveBill(b: { state?: string | null }): boolean {
  return billState(b) === "active";
}

/** Normalise a requested state: "active" or anything unknown is stored as null */
export function cleanState(value: unknown): "paused" | "cancelled" | null {
  return value === "paused" || value === "cancelled" ? value : null;
}
