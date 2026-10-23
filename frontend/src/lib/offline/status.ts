import { useEffect, useSyncExternalStore } from "react";
import {
  checkServer,
  flushOutbox,
  pendingCount,
  OUTBOX_SYNC_TAG,
  SYNC_CHANNEL,
  type SyncMessage,
} from "./outbox";

/**
 * Page-side sync state: whether the server is reachable, how many changes are
 * waiting, and the triggers that drain the outbox (app start, regaining focus,
 * the `online` event, a retry timer, and Android's Background Sync).
 */

export interface SyncState {
  /** null until the first check finishes */
  reachable: boolean | null;
  checkedAt: number;
  pending: number;
  syncing: boolean;
  /** ISO time the server last answered */
  lastOnline: string | null;
}

const LAST_ONLINE_KEY = "fi:lastOnline";
const RETRY_INTERVAL = 20_000;
/** How long a failed check is trusted before views try the network again */
const OFFLINE_TRUST = 60_000;

/** Fired on window when fresh server data is available (reconnected or synced) */
export const REFRESH_EVENT = "fi:refresh";

function readLastOnline(): string | null {
  try {
    return localStorage.getItem(LAST_ONLINE_KEY);
  } catch {
    return null;
  }
}

let state: SyncState = {
  reachable: null,
  checkedAt: 0,
  pending: 0,
  syncing: false,
  lastOnline: readLastOnline(),
};
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSyncStatus(): SyncState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Re-run `callback` whenever fresh server data is available */
export function useOnRefresh(callback: () => void) {
  useEffect(() => {
    window.addEventListener(REFRESH_EVENT, callback);
    return () => window.removeEventListener(REFRESH_EVENT, callback);
  }, [callback]);
}

/** A recent check failed, so skip the network and read from the cache */
export function knownOffline(): boolean {
  return state.reachable === false && Date.now() - state.checkedAt < OFFLINE_TRUST;
}

export function markReachable(ok: boolean) {
  const wasOffline = state.reachable === false;
  const patch: Partial<SyncState> = { reachable: ok, checkedAt: Date.now() };
  if (ok) {
    patch.lastOnline = new Date().toISOString();
    try {
      localStorage.setItem(LAST_ONLINE_KEY, patch.lastOnline);
    } catch {
      // Storage blocked: the timestamp just won't survive a reload
    }
  }
  setState(patch);
  if (ok && wasOffline) {
    window.dispatchEvent(new Event(REFRESH_EVENT));
    void syncNow();
  }
}

async function refreshPending() {
  setState({ pending: await pendingCount() });
}

let running: Promise<void> | null = null;
let rerun = false;

/** Check the connection and, if it's good, send anything waiting. Safe to call often. */
export function syncNow(): Promise<void> {
  if (running) {
    // Something may have been queued after the current run looked: go again
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      await runSync();
    } while (rerun);
  })().finally(() => (running = null));
  return running;
}

async function runSync() {
  setState({ syncing: true });
  try {
    markReachable(await checkServer());
    await refreshPending();
    if (!state.reachable || state.pending === 0) return;
    const result = await flushOutbox();
    if (result.reachable === false) markReachable(false);
  } finally {
    await refreshPending();
    setState({ syncing: false });
  }
}

/** Called after queueing a change: try now, and hand off to Background Sync where supported (Android Chrome) */
export async function changeQueued() {
  void syncNow(); // first, so `syncing` is set before the pending count rises
  await refreshPending();
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sync = (reg as (ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }) | undefined)?.sync;
    await sync?.register(OUTBOX_SYNC_TAG);
  } catch {
    // No service worker or no Background Sync (iOS): the foreground triggers cover it
  }
}

let started = false;

export function startSync() {
  if (started) return;
  started = true;

  window.addEventListener("online", () => void syncNow());
  window.addEventListener("offline", () => markReachable(false));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });

  // Keep retrying while offline or while changes are waiting
  setInterval(() => {
    if (document.visibilityState === "visible" && (state.pending > 0 || state.reachable === false)) {
      void syncNow();
    }
  }, RETRY_INTERVAL);

  // The outbox changed in another tab or the service worker synced it
  try {
    new BroadcastChannel(SYNC_CHANNEL).onmessage = (e: MessageEvent<SyncMessage>) => {
      void refreshPending();
      if (e.data.type === "synced") {
        // markReachable already refreshes views when coming back from offline
        const wasOffline = state.reachable === false;
        markReachable(true);
        if (!wasOffline) window.dispatchEvent(new Event(REFRESH_EVENT));
      }
    };
  } catch {
    // Older browsers: the retry timer keeps the pending count roughly current
  }

  void syncNow();
}
