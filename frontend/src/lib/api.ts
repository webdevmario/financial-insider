import type { Account, Subscription, Expense, AppSettings } from "../types";

const BASE = "/api";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Accounts ───────────────────────────────────────────────────
export const api = {
  accounts: {
    list: () => request<Account[]>("/accounts"),
    get: (id: string) => request<Account>(`/accounts/${id}`),
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
  expenses: {
    list: (month?: string) =>
      request<Expense[]>(
        month ? `/expenses?month=${month}` : "/expenses"
      ),
    months: () => request<string[]>("/expenses/months"),
    create: (data: Partial<Expense>) =>
      request<Expense>("/expenses", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/expenses/${id}`, {
        method: "DELETE",
      }),
  },

  // ── Subscriptions ────────────────────────────────────────────
  subscriptions: {
    list: () => request<Subscription[]>("/subscriptions"),
    get: (id: string) => request<Subscription>(`/subscriptions/${id}`),
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

  // ── Settings ─────────────────────────────────────────────────
  settings: {
    getAll: () => request<Partial<AppSettings>>("/settings"),
    get: <T = unknown>(key: string) =>
      request<{ key: string; value: T }>(`/settings/${key}`),
    set: (key: string, value: unknown) =>
      request(`/settings/${key}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      }),
  },

  // ── Dashboard ────────────────────────────────────────────────
  dashboard: {
    summary: () =>
      request<{
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
