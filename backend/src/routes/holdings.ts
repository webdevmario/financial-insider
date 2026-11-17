import { Router, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, holdings, securities, settings } from "../db/schema.js";
import { today } from "../lib/date.js";
import {
  ASSET_CLASSES, ASSET_CLASS_LABELS, KINDS, ROLES, STATUSES, TARGETS_KEY,
  loadTargets, overview, parseTargets,
} from "../lib/holdings/load.js";

const router = Router();

/** Account types that can hold investments; the rest (checking, home, cars) never show in the account picker */
const INVESTMENT_TYPES = ["Roth 401k", "401k", "Rollover IRA", "Roth IRA", "IRA", "HSA", "Brokerage", "Crypto", "Other"];

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const symbolOf = (v: unknown) => (str(v) ?? "").toUpperCase();

function oneOf<T extends string>(v: unknown, list: readonly T[], field: string): T {
  if (typeof v === "string" && (list as readonly string[]).includes(v)) return v as T;
  throw new Error(`${field} must be one of: ${list.join(", ")}`);
}

const fail = (res: Response, err: unknown, status = 400) =>
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });

// ── Overview ──────────────────────────────────────────────────────

// GET /api/holdings?asOf=YYYY-MM-DD: each account's latest snapshot (on or before asOf), the mix, flags
router.get("/", (req, res) => {
  const asOf = req.query.asOf;
  if (asOf != null && !isDate(asOf)) return fail(res, "asOf must be YYYY-MM-DD");
  res.json(overview(asOf as string | undefined));
});

// GET /api/holdings/meta: choices for the forms, the targets, and the accounts that can hold investments
router.get("/meta", (_req, res) => {
  res.json({
    kinds: KINDS,
    assetClasses: ASSET_CLASSES,
    assetClassLabels: ASSET_CLASS_LABELS,
    roles: ROLES,
    statuses: STATUSES,
    targets: loadTargets(),
    accounts: db.select().from(accounts).all().filter((a) => INVESTMENT_TYPES.includes(a.type)),
  });
});

// PUT /api/holdings/targets
router.put("/targets", (req, res) => {
  const targets = parseTargets({ ...loadTargets(), ...(req.body ?? {}) });
  const value = JSON.stringify(targets);
  db.insert(settings).values({ key: TARGETS_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  res.json(targets);
});

// ── Securities: the household's list ─────────────────────────────

function securityFields(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || "symbol" in body) {
    const symbol = symbolOf(body.symbol);
    if (!symbol) throw new Error("Symbol is required");
    if (symbol.length > 24) throw new Error("Symbol is too long");
    out.symbol = symbol;
  }
  if ("name" in body) out.name = str(body.name);
  if ("kind" in body) out.kind = oneOf(body.kind, KINDS, "kind");
  if ("assetClass" in body) out.assetClass = oneOf(body.assetClass, ASSET_CLASSES, "assetClass");
  if ("role" in body) out.role = oneOf(body.role, ROLES, "role");
  if ("status" in body) out.status = oneOf(body.status, STATUSES, "status");
  if ("expenseRatio" in body) out.expenseRatio = num(body.expenseRatio);
  if ("why" in body) out.why = str(body.why);
  if ("notes" in body) out.notes = str(body.notes);
  return out;
}

function symbolTaken(symbol: string, exceptId?: string): boolean {
  const row = db.select({ id: securities.id }).from(securities).where(eq(securities.symbol, symbol)).get();
  return !!row && row.id !== exceptId;
}

router.get("/securities", (_req, res) => {
  res.json(db.select().from(securities).all().sort((a, b) => a.symbol.localeCompare(b.symbol)));
});

router.post("/securities", (req, res) => {
  try {
    const fields = securityFields(req.body ?? {}, false);
    if (symbolTaken(fields.symbol as string)) return fail(res, `${fields.symbol} is already on the list`, 409);
    const row = {
      id: newId(), kind: "other", assetClass: "other", role: "core", status: "keep",
      ...fields, createdAt: today(), updatedAt: null,
    } as typeof securities.$inferInsert;
    db.insert(securities).values(row).run();
    res.status(201).json(db.select().from(securities).where(eq(securities.id, row.id)).get());
  } catch (err) {
    fail(res, err);
  }
});

router.patch("/securities/:id", (req, res) => {
  const existing = db.select().from(securities).where(eq(securities.id, req.params.id)).get();
  if (!existing) return fail(res, "Not found", 404);
  try {
    const fields = securityFields(req.body ?? {}, true);
    if (fields.symbol && symbolTaken(fields.symbol as string, existing.id)) return fail(res, `${fields.symbol} is already on the list`, 409);
    db.update(securities).set({ ...fields, updatedAt: today() }).where(eq(securities.id, existing.id)).run();
    res.json(db.select().from(securities).where(eq(securities.id, existing.id)).get());
  } catch (err) {
    fail(res, err);
  }
});

// Only a security that no snapshot uses can be deleted; otherwise mark it "remove" so the history stays whole
router.delete("/securities/:id", (req, res) => {
  const existing = db.select().from(securities).where(eq(securities.id, req.params.id)).get();
  if (!existing) return fail(res, "Not found", 404);
  const used = db.select({ id: holdings.id }).from(holdings).where(eq(holdings.securityId, existing.id)).get();
  if (used) return fail(res, `${existing.symbol} is in past snapshots. Mark it "remove" instead of deleting it.`, 409);
  db.delete(securities).where(eq(securities.id, existing.id)).run();
  res.json({ success: true });
});

// ── Snapshots ────────────────────────────────────────────────────

// GET /api/holdings/snapshot?accountId=…&asOf=…: one account's rows on a date (default: its latest)
router.get("/snapshot", (req, res) => {
  const accountId = str(req.query.accountId);
  if (!accountId) return fail(res, "accountId is required");
  const rows = db.select().from(holdings).where(eq(holdings.accountId, accountId)).all();
  let asOf = req.query.asOf as string | undefined;
  if (asOf != null && !isDate(asOf)) return fail(res, "asOf must be YYYY-MM-DD");
  if (!asOf) asOf = rows.reduce<string | undefined>((m, r) => (!m || r.asOf > m ? r.asOf : m), undefined);
  const secs = new Map(db.select().from(securities).all().map((s) => [s.id, s]));
  res.json({
    accountId,
    asOf: asOf ?? null,
    rows: rows
      .filter((r) => r.asOf === asOf)
      .map((r) => ({ ...r, symbol: secs.get(r.securityId)?.symbol ?? "?" }))
      .sort((a, b) => b.value - a.value),
  });
});

/**
 * PUT /api/holdings/snapshot { accountId, asOf, previousAsOf?, rows: [{ securityId | symbol, shares, value, costBasis, role }] }
 * Replaces the account's rows on that date. A symbol not on the list yet is added to it (asset class "other",
 * status "watch") so it shows up to be filled in. previousAsOf moves an edited snapshot to a new date.
 */
router.put("/snapshot", (req, res) => {
  const body = req.body ?? {};
  const accountId = str(body.accountId);
  if (!accountId || !db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get()) {
    return fail(res, "Pick an account");
  }
  if (!isDate(body.asOf)) return fail(res, "asOf must be a real date, YYYY-MM-DD");
  if (body.previousAsOf != null && !isDate(body.previousAsOf)) return fail(res, "previousAsOf must be YYYY-MM-DD");
  if (!Array.isArray(body.rows) || body.rows.length === 0) return fail(res, "Add at least one holding");

  const created: string[] = [];
  try {
    const result = db.transaction((tx) => {
      const bySymbol = new Map(tx.select().from(securities).all().map((s) => [s.symbol, s]));
      const byId = new Map([...bySymbol.values()].map((s) => [s.id, s]));
      const seen = new Set<string>();
      const rows = (body.rows as Record<string, unknown>[]).map((r, i) => {
        let sec = r.securityId ? byId.get(String(r.securityId)) : undefined;
        const symbol = symbolOf(r.symbol);
        if (!sec && symbol) {
          sec = bySymbol.get(symbol);
          if (!sec) {
            if (symbol.length > 24) throw new Error(`Row ${i + 1}: symbol is too long`);
            const row = {
              id: newId(), symbol, name: null, kind: "other", assetClass: "other", role: "core", status: "watch",
              expenseRatio: null, why: null, notes: null, createdAt: today(), updatedAt: null,
            };
            tx.insert(securities).values(row).run();
            bySymbol.set(symbol, row);
            byId.set(row.id, row);
            created.push(symbol);
            sec = row;
          }
        }
        if (!sec) throw new Error(`Row ${i + 1}: pick a security or type a symbol`);
        if (seen.has(sec.id)) throw new Error(`${sec.symbol} is listed twice`);
        seen.add(sec.id);
        const value = num(r.value);
        if (value == null) throw new Error(`${sec.symbol}: value is required`);
        const role = r.role == null || r.role === "" ? null : oneOf(r.role, ROLES, `${sec.symbol} role`);
        return {
          id: newId(), accountId, securityId: sec.id, asOf: body.asOf as string,
          shares: num(r.shares), value: Math.round(value * 100) / 100, costBasis: num(r.costBasis),
          // Store a role only when it differs from the security's own
          role: role && role !== sec.role ? role : null,
          createdAt: today(),
        };
      });
      for (const date of new Set([body.asOf as string, (body.previousAsOf as string | undefined) ?? body.asOf])) {
        tx.delete(holdings).where(and(eq(holdings.accountId, accountId), eq(holdings.asOf, date))).run();
      }
      for (const row of rows) tx.insert(holdings).values(row).run();
      return rows.length;
    });
    res.json({ saved: result, created });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/holdings/snapshot?accountId=…&asOf=…
router.delete("/snapshot", (req, res) => {
  const accountId = str(req.query.accountId);
  const asOf = req.query.asOf;
  if (!accountId || !isDate(asOf)) return fail(res, "accountId and asOf are required");
  const result = db.delete(holdings).where(and(eq(holdings.accountId, accountId), eq(holdings.asOf, asOf))).run();
  res.json({ deleted: result.changes });
});

export default router;
