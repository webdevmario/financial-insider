import type {
  Account, Subscription, Expense, Goal, AppSettings, Transaction, StatementAccount, ScanResult,
  ImportBatch, Insights, Payee, PayeeDetail, UnassignedMerchant, UnassignedTxn, PayeeSuggestion, AliasPreview,
} from "../types";
import { today } from "./formatters";
import { offlineDb } from "./offline/db";
import { enqueue, pendingOps } from "./offline/outbox";
import { changeQueued, knownOffline, markReachable } from "./offline/status";

const BASE = "/api";
const READ_TIMEOUT = 6000;
const WRITE_TIMEOUT = 15000;

/** The server couldn't be reached (no network, too slow, or the Mac/server is down) */
export class OfflineError extends Error {
  constructor(message = "You're offline — this needs a connection") {
    super(message);
    this.name = "OfflineError";
  }
}

async function request<T>(
  path: string,
  options?: RequestInit,
  timeout = WRITE_TIMEOUT
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeout),
      ...options,
    });
  } catch {
    markReachable(false);
    throw new OfflineError();
  }
  // Tailscale Serve answers 502 when the Mac is up but the server isn't
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    markReachable(false);
    throw new OfflineError();
  }
  markReachable(true);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Offline read cache ─────────────────────────────────────────

async function readCached<T>(path: string): Promise<T | undefined> {
  try {
    const db = await offlineDb();
    return (await db.get("cache", path))?.data as T | undefined;
  } catch {
    return undefined;
  }
}

async function writeCached(path: string, data: unknown): Promise<void> {
  try {
    const db = await offlineDb();
    await db.put("cache", { path, data, savedAt: new Date().toISOString() });
  } catch {
    // Storage unavailable (private mode): reads just won't work offline
  }
}

/**
 * GET with an offline fallback: use the network when it answers in time and
 * save the response; otherwise serve the last saved copy.
 */
async function cachedGet<T>(path: string): Promise<T> {
  if (!knownOffline()) {
    try {
      const data = await request<T>(path, undefined, READ_TIMEOUT);
      void writeCached(path, data);
      return data;
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;
    }
  }
  const cached = await readCached<T>(path);
  if (cached === undefined) throw new OfflineError("You're offline and this hasn't been loaded on this device yet");
  return cached;
}

// ── Offline expenses ───────────────────────────────────────────

/** Time-prefixed like server ids, so "newest first" ordering by id still holds */
function newExpenseId(): string {
  const rand = crypto.getRandomValues(new Uint32Array(2));
  return Date.now().toString(36) + Array.from(rand, (n) => n.toString(36)).join("").slice(0, 8);
}

async function findCachedExpense(id: string): Promise<Expense | undefined> {
  const db = await offlineDb();
  for (const entry of await db.getAll("cache")) {
    if (!entry.path.startsWith("/expenses") || !Array.isArray(entry.data)) continue;
    const match = (entry.data as Expense[]).find((e) => e.id === id);
    if (match) return match;
  }
  return undefined;
}

/** Layer changes still waiting in the outbox over a server (or cached) list */
async function withPendingExpenses(list: Expense[], month?: string): Promise<Expense[]> {
  const ops = await pendingOps();
  if (!ops.length) return list;

  const byId = new Map(list.map((e) => [e.id, e]));
  for (const op of ops) {
    if (op.kind === "delete") {
      byId.delete(op.id);
      continue;
    }
    const base = byId.get(op.id) ?? (op.kind === "update" ? await findCachedExpense(op.id) : undefined);
    if (op.kind === "update" && !base) continue;
    const merged = { ...base, ...op.data, pending: true } as Expense;
    if (month && merged.month !== month) byId.delete(op.id);
    else byId.set(op.id, merged);
  }
  return [...byId.values()];
}

async function withPendingMonths(months: string[]): Promise<string[]> {
  const set = new Set(months);
  for (const op of await pendingOps()) {
    if (op.kind !== "delete" && op.data.month) set.add(op.data.month);
  }
  return [...set].sort().reverse();
}

// ── Accounts ───────────────────────────────────────────────────
export const api = {
  accounts: {
    list: () => cachedGet<Account[]>("/accounts"),
    get: (id: string) => cachedGet<Account>(`/accounts/${id}`),
    create: (data: Partial<Account>) =>
      request<Account>("/accounts", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Account>) =>
      request<Account>(`/accounts/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/accounts/${id}`, {
        method: "DELETE",
      }),
  },

  // ── Expenses ─────────────────────────────────────────────────
  // Writes go through the on-device outbox so they work offline; reads
  // include changes that haven't synced yet.
  expenses: {
    list: async (month?: string) =>
      withPendingExpenses(
        await cachedGet<Expense[]>(month ? `/expenses?month=${month}` : "/expenses"),
        month
      ),
    months: async () => withPendingMonths(await cachedGet<string[]>("/expenses/months")),
    create: async (data: Partial<Expense>): Promise<Expense> => {
      const date = data.date || today();
      const record: Expense = {
        id: newExpenseId(),
        date,
        month: data.month || date.slice(0, 7),
        description: data.description || "",
        category: data.category || "General",
        amount: data.amount || 0,
        updatedAt: new Date().toISOString(),
      };
      await enqueue({ kind: "create", id: record.id, data: record });
      void changeQueued();
      return { ...record, pending: true };
    },
    update: async (id: string, data: Partial<Expense>): Promise<Expense> => {
      const { pending: _pending, id: _id, ...fields } = data;
      const patch = { ...fields, updatedAt: new Date().toISOString() };
      await enqueue({ kind: "update", id, data: patch });
      void changeQueued();
      return { id, ...patch, pending: true } as Expense;
    },
    delete: async (id: string) => {
      await enqueue({ kind: "delete", id });
      void changeQueued();
      return { success: true };
    },
  },

  // ── Subscriptions ────────────────────────────────────────────
  subscriptions: {
    list: () => cachedGet<Subscription[]>("/subscriptions"),
    get: (id: string) => cachedGet<Subscription>(`/subscriptions/${id}`),
    create: (data: Partial<Subscription>) =>
      request<Subscription>("/subscriptions", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Subscription>) =>
      request<Subscription>(`/subscriptions/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/subscriptions/${id}`, {
        method: "DELETE",
      }),
  },

  // ── Goals ────────────────────────────────────────────────────
  goals: {
    list: () => cachedGet<Goal[]>("/goals"),
    create: (data: Partial<Goal>) =>
      request<Goal>("/goals", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Goal>) =>
      request<Goal>(`/goals/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    contribute: (id: string, data: { amount: number; date?: string; note?: string }) =>
      request<Goal>(`/goals/${id}/contributions`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/goals/${id}`, {
        method: "DELETE",
      }),
  },

  // ── Imported transactions ────────────────────────────────────
  transactions: {
    list: (params: { month?: string; account?: string; kind?: string; q?: string; limit?: number } = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])
      ).toString();
      return cachedGet<Transaction[]>(`/transactions${qs ? `?${qs}` : ""}`);
    },
    insights: (month?: string) =>
      cachedGet<Insights>(`/transactions/insights${month ? `?month=${month}` : ""}`),
    accounts: () => cachedGet<StatementAccount[]>("/transactions/accounts"),
    renameAccount: (id: string, name: string) =>
      request<{ success: boolean }>(`/transactions/accounts/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name }),
      }),
    update: (
      id: string,
      data: {
        payeeId?: string | null;
        payeeName?: string;
        category?: string;
        kind?: string;
        remember?: { pattern: string; match: string; amount?: number | null };
        reset?: boolean;
      }
    ) =>
      request<Transaction>(`/transactions/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    imports: () =>
      cachedGet<{ folder: string; lastScan: ScanResult | null; batches: ImportBatch[] }>("/transactions/imports"),
    scan: () => request<ScanResult>("/transactions/scan", { method: "POST" }),
    upload: (name: string, content: string, encoding: "utf8" | "base64" = "utf8") =>
      request<ScanResult>("/transactions/upload", {
        method: "POST",
        body: JSON.stringify({ name, content, encoding }),
      }),
    undoImport: (id: string) =>
      request<{ removed: number }>(`/transactions/imports/${id}/undo`, { method: "POST" }),
    reimport: (id: string) =>
      request<ScanResult>(`/transactions/imports/${id}/forget`, { method: "POST" }),
  },

  // ── Payees (final names + aliases) ───────────────────────────
  payees: {
    list: () => cachedGet<Payee[]>("/payees"),
    get: (id: string) => cachedGet<PayeeDetail>(`/payees/${id}`),
    unassigned: () => cachedGet<UnassignedMerchant[]>("/payees/unassigned"),
    unassignedTransactions: (key: string, limit?: number) =>
      cachedGet<{ total: number; rows: UnassignedTxn[] }>(
        `/payees/unassigned/${encodeURIComponent(key)}/transactions${limit ? `?limit=${limit}` : ""}`
      ),
    suggestions: () => cachedGet<PayeeSuggestion[]>("/payees/suggestions"),
    dismissSuggestion: (id: string) =>
      request<{ success: boolean }>(`/payees/suggestions/${encodeURIComponent(id)}/dismiss`, { method: "POST" }),
    preview: (data: { pattern: string; match: string; amount?: number | null }) =>
      request<AliasPreview>("/payees/preview", { method: "POST", body: JSON.stringify(data) }),
    merge: (data: { payeeId?: string; name?: string; category?: string; members: string[] }) =>
      request<PayeeDetail>("/payees/merge", { method: "POST", body: JSON.stringify(data) }),
    create: (data: { name: string; category?: string | null; kind?: string | null; billId?: string | null }) =>
      request<PayeeDetail>("/payees", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: { name?: string; category?: string | null; kind?: string | null; billId?: string | null; notes?: string | null }) =>
      request<PayeeDetail>(`/payees/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) => request<{ success: boolean }>(`/payees/${id}`, { method: "DELETE" }),
    addAlias: (id: string, data: { pattern: string; match: string; amount?: number | null }) =>
      request<PayeeDetail>(`/payees/${id}/aliases`, { method: "POST", body: JSON.stringify(data) }),
    deleteAlias: (id: string, aliasId: string) =>
      request<PayeeDetail>(`/payees/${id}/aliases/${aliasId}`, { method: "DELETE" }),
  },

  // ── Settings ─────────────────────────────────────────────────
  settings: {
    getAll: () => cachedGet<Partial<AppSettings>>("/settings"),
    get: <T = unknown>(key: string) =>
      cachedGet<{ key: string; value: T }>(`/settings/${key}`),
    set: async (key: string, value: unknown) => {
      const res = await request(`/settings/${key}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      });
      // Keep the offline copy in step so it isn't stale next time
      void writeCached(`/settings/${key}`, { key, value });
      return res;
    },
  },

  // ── Dashboard ────────────────────────────────────────────────
  dashboard: {
    summary: () =>
      cachedGet<{
        netWorth: number;
        income: number;
        monthlyBills: number;
      }>("/dashboard/summary"),
  },

  // ── Data management ──────────────────────────────────────────
  data: {
    export: () => request<unknown>("/data/export"),
    import: (data: unknown) =>
      request<{ success: boolean }>("/data/import", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
};
