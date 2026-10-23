import { offlineDb, type OutboxOp } from "./db";

/**
 * The outbox: expense changes made on this device, stored in IndexedDB until
 * the server acknowledges them. Shared by the page and the service worker, so
 * this module must not touch `window` or the DOM.
 */

export const OUTBOX_SYNC_TAG = "fi-outbox";
export const SYNC_CHANNEL = "fi-sync";

export type SyncMessage = { type: "changed" } | { type: "synced"; sent: number };

const HEALTH_TIMEOUT = 4000;
const SEND_TIMEOUT = 10000;

type NewOp = OutboxOp extends infer O ? (O extends OutboxOp ? Omit<O, "seq" | "rev"> : never) : never;

function broadcast(msg: SyncMessage) {
  try {
    const channel = new BroadcastChannel(SYNC_CHANNEL);
    channel.postMessage(msg);
    channel.close();
  } catch {
    // BroadcastChannel unavailable: pages fall back to polling the pending count
  }
}

/** All queued ops, oldest first */
export async function pendingOps(): Promise<OutboxOp[]> {
  const db = await offlineDb();
  return db.getAll("outbox");
}

export async function pendingCount(): Promise<number> {
  const db = await offlineDb();
  return db.count("outbox");
}

/**
 * Queue a change, collapsing it into earlier queued ops for the same expense:
 * edits fold into a pending create/update, and deleting something that was
 * never synced just drops it.
 */
export async function enqueue(op: NewOp): Promise<void> {
  const db = await offlineDb();
  const tx = db.transaction("outbox", "readwrite");
  const existing = await tx.store.index("byId").getAll(op.id);
  const create = existing.find((o) => o.kind === "create");

  if (op.kind === "update") {
    const target = create ?? existing.filter((o) => o.kind === "update").pop();
    if (target) {
      await tx.store.put({ ...target, data: { ...target.data, ...op.data }, rev: target.rev + 1 } as OutboxOp);
    } else {
      await tx.store.add({ ...op, rev: 0 });
    }
  } else if (op.kind === "delete") {
    for (const o of existing) await tx.store.delete(o.seq!);
    if (!create) await tx.store.add({ ...op, rev: 0 });
  } else {
    await tx.store.add({ ...op, rev: 0 });
  }

  await tx.done;
  broadcast({ type: "changed" });
}

/** True when the server answers quickly enough to be worth syncing with */
export async function checkServer(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface FlushResult {
  sent: number;
  remaining: number;
  /** false when the network failed mid-flush, null when another context was already flushing */
  reachable: boolean | null;
}

/**
 * Send queued ops to the server in order. Stops at the first network failure
 * and leaves the rest queued. Only one context (page or service worker) drains
 * at a time.
 */
export async function flushOutbox(): Promise<FlushResult> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("fi-outbox-flush", { ifAvailable: true }, async (lock) =>
      lock ? drain() : { sent: 0, remaining: await pendingCount(), reachable: null }
    );
  }
  return drain();
}

async function drain(): Promise<FlushResult> {
  const db = await offlineDb();
  let sent = 0;

  try {
    for (;;) {
      const cursor = await db.transaction("outbox").store.openCursor();
      const op = cursor?.value;
      if (!op) return { sent, remaining: 0, reachable: true };

      let outcome: "done" | "retry";
      try {
        outcome = await send(op);
      } catch {
        return { sent, remaining: await pendingCount(), reachable: false };
      }
      if (outcome === "retry") return { sent, remaining: await pendingCount(), reachable: true };

      await settle(op);
      sent++;
    }
  } finally {
    if (sent > 0) broadcast({ type: "synced", sent });
  }
}

async function send(op: OutboxOp): Promise<"done" | "retry"> {
  const id = encodeURIComponent(op.id);
  const init: RequestInit = {
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(SEND_TIMEOUT),
  };

  let res: Response;
  if (op.kind === "create") {
    res = await fetch("/api/expenses", { ...init, method: "POST", body: JSON.stringify(op.data) });
  } else if (op.kind === "update") {
    res = await fetch(`/api/expenses/${id}`, { ...init, method: "PUT", body: JSON.stringify(op.data) });
  } else {
    res = await fetch(`/api/expenses/${id}`, { ...init, method: "DELETE" });
  }

  if (res.ok) return "done";
  // Server down behind the Tailscale proxy, or a transient error: try again later
  if (res.status >= 500) return "retry";
  // Edited or deleted something already deleted elsewhere: nothing left to do
  if (res.status === 404 && op.kind !== "create") return "done";
  // Anything else would fail forever, so drop it rather than block the queue
  console.error(`Dropping outbox op ${op.kind} ${op.id}: HTTP ${res.status}`);
  return "done";
}

/**
 * Remove an op the server accepted, unless it changed while in flight:
 * - edited (rev bumped): keep it so the merged edit is sent too
 * - a create that was deleted meanwhile: the server now has it, so queue a delete
 */
async function settle(op: OutboxOp): Promise<void> {
  const db = await offlineDb();
  const tx = db.transaction("outbox", "readwrite");
  const current = await tx.store.get(op.seq!);

  if (!current) {
    if (op.kind === "create") await tx.store.add({ kind: "delete", id: op.id, rev: 0 });
  } else if (current.rev === op.rev) {
    await tx.store.delete(op.seq!);
  } else if (current.kind === "create") {
    await tx.store.put({
      seq: current.seq,
      rev: 0,
      kind: "update",
      id: current.id,
      data: { ...current.data, updatedAt: current.data.updatedAt ?? new Date().toISOString() },
    });
  }

  await tx.done;
}
