const BASE = "/api";
async function request(path, options) {
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
        list: () => request("/accounts"),
        get: (id) => request(`/accounts/${id}`),
        create: (data) => request("/accounts", {
            method: "POST",
            body: JSON.stringify(data),
        }),
        update: (id, data) => request(`/accounts/${id}`, {
            method: "PUT",
            body: JSON.stringify(data),
        }),
        delete: (id) => request(`/accounts/${id}`, {
            method: "DELETE",
        }),
    },
    // ── Expenses ─────────────────────────────────────────────────
    expenses: {
        list: (month) => request(month ? `/expenses?month=${month}` : "/expenses"),
        months: () => request("/expenses/months"),
        create: (data) => request("/expenses", {
            method: "POST",
            body: JSON.stringify(data),
        }),
        delete: (id) => request(`/expenses/${id}`, {
            method: "DELETE",
        }),
    },
    // ── Subscriptions ────────────────────────────────────────────
    subscriptions: {
        list: () => request("/subscriptions"),
        get: (id) => request(`/subscriptions/${id}`),
        create: (data) => request("/subscriptions", {
            method: "POST",
            body: JSON.stringify(data),
        }),
        update: (id, data) => request(`/subscriptions/${id}`, {
            method: "PUT",
            body: JSON.stringify(data),
        }),
        delete: (id) => request(`/subscriptions/${id}`, {
            method: "DELETE",
        }),
    },
    // ── Settings ─────────────────────────────────────────────────
    settings: {
        getAll: () => request("/settings"),
        get: (key) => request(`/settings/${key}`),
        set: (key, value) => request(`/settings/${key}`, {
            method: "PUT",
            body: JSON.stringify({ value }),
        }),
    },
    // ── Dashboard ────────────────────────────────────────────────
    dashboard: {
        summary: () => request("/dashboard/summary"),
    },
    // ── Data management ──────────────────────────────────────────
    data: {
        export: () => request("/data/export"),
        import: (data) => request("/data/import", {
            method: "POST",
            body: JSON.stringify(data),
        }),
    },
};
