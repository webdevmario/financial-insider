/**
 * Payees: one final name for everything that's really the same merchant.
 *
 * A payee has aliases: statement text that means it ("NETFLIX.COM", "NETFLIX INC").
 * Each transaction keeps what the bank said (base_merchant / base_category / base_kind);
 * its merchant, category and kind are recomputed from that plus the matching payee
 * whenever payees or aliases change. Hand edits on one transaction always win.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  importBatches, merchantRules, payeeAliases, payees, settings, statementAccounts, transactions,
  type Payee, type PayeeAlias, type Transaction,
} from "../../db/schema.js";
import { KINDS, parseRow, type Kind } from "./formats.js";
import { merchantKey, normalizeMerchant } from "./merchant.js";

export const MATCH_TYPES = ["contains", "starts", "exact", "merchant"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const round = (n: number) => Math.round(n * 100) / 100;

// ── Matching ──────────────────────────────────────────────────────

interface Matchable {
  description: string;
  baseMerchant: string | null;
  amount: number;
}

const MATCH_RANK: Record<string, number> = { exact: 0, merchant: 1, starts: 2, contains: 3 };

/** Most specific first: amount-limited, then exact, merchant, starts-with, contains; longer patterns first */
export function sortAliases(aliases: PayeeAlias[]): PayeeAlias[] {
  return [...aliases].sort(
    (a, b) =>
      Number(b.amount != null) - Number(a.amount != null) ||
      (MATCH_RANK[a.match] ?? 9) - (MATCH_RANK[b.match] ?? 9) ||
      b.pattern.length - a.pattern.length
  );
}

export function aliasMatches(alias: Pick<PayeeAlias, "pattern" | "match" | "amount">, t: Matchable): boolean {
  if (alias.amount != null && Math.abs(Math.abs(t.amount) - Math.abs(alias.amount)) > 0.005) return false;
  const p = alias.pattern.trim().toUpperCase();
  if (!p) return false;
  const d = t.description.toUpperCase();
  const m = (t.baseMerchant || "").toUpperCase();
  switch (alias.match) {
    case "exact":
      return d === p;
    case "merchant":
      return merchantKey(t.baseMerchant || "") === merchantKey(alias.pattern);
    case "starts":
      return d.startsWith(p) || m.startsWith(p);
    default:
      return d.includes(p) || m.includes(p);
  }
}

// ── Recompute ─────────────────────────────────────────────────────

/** Grouping key for a transaction: its payee, or else its cleaned-up bank name */
export function groupKey(t: Pick<Transaction, "payeeId" | "merchant">): string {
  return t.payeeId ? `p:${t.payeeId}` : `m:${merchantKey(t.merchant)}`;
}

/**
 * Re-derive merchant / category / kind for every transaction from what the bank said,
 * the matching payee, and any hand edits. Also breaks transfer pairs a payee says
 * aren't transfers. Returns how many rows changed.
 */
export function recomputeAll(): number {
  const all = db.select().from(transactions).all();
  const payeeById = new Map(db.select().from(payees).all().map((p) => [p.id, p]));
  const aliases = sortAliases(db.select().from(payeeAliases).all()).filter((a) => payeeById.has(a.payeeId));

  // Pass 1: payee per transaction
  const assigned = all.map((t) => {
    if (t.payeeLocked && t.payeeId && payeeById.has(t.payeeId)) return { payeeId: t.payeeId, aliasId: null as string | null };
    const alias = aliases.find((a) => aliasMatches(a, t));
    return { payeeId: alias?.payeeId ?? null, aliasId: alias?.id ?? null };
  });

  // Categories to borrow: banks without categories (Amex, Ally) take the most common
  // category the same payee / merchant has elsewhere
  const counts = new Map<string, Map<string, number>>();
  all.forEach((t, i) => {
    const c = t.baseCategory;
    if (!c || c === "Uncategorized" || c === "Transfer") return;
    const k = assigned[i].payeeId ? `p:${assigned[i].payeeId}` : `m:${merchantKey(t.baseMerchant || t.merchant)}`;
    const m = counts.get(k) ?? counts.set(k, new Map()).get(k)!;
    m.set(c, (m.get(c) || 0) + 1);
  });
  const borrowed = (k: string) => {
    const m = counts.get(k);
    return m ? [...m].sort((a, b) => b[1] - a[1])[0][0] : null;
  };

  const unpair = new Set<string>();
  const updates: { id: string; set: Partial<Transaction> }[] = [];

  all.forEach((t, i) => {
    const { payeeId, aliasId } = assigned[i];
    const payee = payeeId ? payeeById.get(payeeId) : undefined;
    const baseMerchant = t.baseMerchant || t.merchant;
    const baseKind = (t.baseKind || t.kind) as Kind;

    let kind: string;
    if (t.edited) kind = t.kind;
    else if (payee?.kind && KINDS.includes(payee.kind as Kind)) {
      kind = payee.kind;
      if (kind !== "transfer" && t.transferPeerId) unpair.add(t.id);
    } else if (t.transferPeerId) kind = "transfer";
    else kind = baseKind;

    let category: string;
    if (t.edited) category = t.category;
    else if (kind === "transfer") category = "Transfer";
    else if (payee?.category) category = payee.category;
    else {
      const base = t.baseCategory && t.baseCategory !== "Transfer" ? t.baseCategory : "Uncategorized";
      category = base !== "Uncategorized" ? base : borrowed(payeeId ? `p:${payeeId}` : `m:${merchantKey(baseMerchant)}`) ?? "Uncategorized";
    }

    const merchant = payee?.name ?? baseMerchant;
    if (
      t.merchant !== merchant || t.category !== category || t.kind !== kind ||
      t.payeeId !== payeeId || t.aliasId !== aliasId
    ) {
      updates.push({ id: t.id, set: { merchant, category, kind, payeeId, aliasId } });
    }
  });

  if (updates.length || unpair.size) {
    db.transaction((tx) => {
      for (const u of updates) tx.update(transactions).set(u.set).where(eq(transactions.id, u.id)).run();
      for (const id of unpair) {
        const t = all.find((x) => x.id === id)!;
        tx.update(transactions).set({ transferPeerId: null }).where(eq(transactions.id, id)).run();
        if (t.transferPeerId) {
          // The other side goes back to what the bank said
          const peer = all.find((x) => x.id === t.transferPeerId);
          tx.update(transactions)
            .set({
              transferPeerId: null,
              kind: peer?.edited ? peer.kind : peer?.baseKind || peer?.kind || "spend",
            })
            .where(eq(transactions.id, t.transferPeerId))
            .run();
        }
      }
    });
  }
  // Rows just unpaired go back to their own kind on a second pass
  return updates.length + (unpair.size ? recomputeAll() : 0);
}

// ── One-time migration ────────────────────────────────────────────

function settingFlag(key: string): boolean {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row ? JSON.parse(row.value) === true : false;
}

function setFlag(key: string) {
  db.insert(settings).values({ key, value: "true" }).onConflictDoUpdate({ target: settings.key, set: { value: "true" } }).run();
}

export function findOrCreatePayee(name: string, defaults: Partial<Payee> = {}): Payee {
  const clean = name.trim();
  const existing = db.select().from(payees).all().find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const row: Payee = {
    id: newId(),
    name: clean,
    category: defaults.category ?? null,
    kind: defaults.kind ?? null,
    billId: defaults.billId ?? null,
    notes: null,
    createdAt: new Date().toISOString(),
  };
  db.insert(payees).values(row).run();
  return row;
}

export function addAlias(payeeId: string, pattern: string, match: string = "contains", amount: number | null = null): PayeeAlias {
  const row: PayeeAlias = {
    id: newId(),
    payeeId,
    pattern: pattern.trim(),
    match: (MATCH_TYPES as readonly string[]).includes(match) ? match : "contains",
    amount: amount != null && Number.isFinite(amount) ? round(Math.abs(amount)) : null,
    createdAt: new Date().toISOString(),
  };
  const dup = db
    .select()
    .from(payeeAliases)
    .where(eq(payeeAliases.payeeId, payeeId))
    .all()
    .find((a) => a.pattern.toLowerCase() === row.pattern.toLowerCase() && a.match === row.match && a.amount === row.amount);
  if (dup) return dup;
  db.insert(payeeAliases).values(row).run();
  return row;
}

/**
 * Runs on every startup; each step only does work once.
 * 1. Fill base_merchant / base_category / base_kind by re-reading each stored CSV row.
 * 2. Turn merchant rules into payees + aliases, and hand-renamed rows into hand-picked payees.
 */
export function migratePayees() {
  const formatByBatch = new Map(db.select({ id: importBatches.id, format: importBatches.format }).from(importBatches).all().map((b) => [b.id, b.format]));
  const missing = db.select().from(transactions).all().filter((t) => t.baseMerchant == null);
  if (missing.length) {
    db.transaction((tx) => {
      for (const t of missing) {
        let parsed = null;
        try {
          const format = formatByBatch.get(t.batchId);
          if (format && t.raw) parsed = parseRow(format, JSON.parse(t.raw));
        } catch {
          parsed = null;
        }
        tx.update(transactions)
          .set({
            baseMerchant: parsed?.merchant ?? normalizeMerchant(t.description),
            baseCategory: parsed?.category ?? t.category,
            baseKind: parsed?.kind ?? t.kind,
          })
          .where(eq(transactions.id, t.id))
          .run();
      }
    });
  }

  if (!settingFlag("payeesMigrated")) {
    const rules = db.select().from(merchantRules).all();
    const rows = db.select().from(transactions).all();
    db.transaction(() => {
      for (const r of rules) {
        const matching = rows.filter((t) => aliasMatches({ pattern: r.pattern, match: "contains", amount: null }, t));
        const name = r.merchant || matching[0]?.merchant || r.pattern;
        const payee = findOrCreatePayee(name, { category: r.category, kind: r.kind });
        addAlias(payee.id, r.pattern, "contains");
        // Their effect now comes from the payee
        if (matching.length) {
          db.update(transactions).set({ edited: 0 }).where(inArray(transactions.id, matching.map((t) => t.id))).run();
        }
      }
      // Rows renamed by hand (no rule): keep the name as a hand-picked payee
      for (const t of rows) {
        if (!t.edited || !t.baseMerchant) continue;
        if (rules.some((r) => aliasMatches({ pattern: r.pattern, match: "contains", amount: null }, t))) continue;
        if (merchantKey(t.merchant) !== merchantKey(t.baseMerchant)) {
          const payee = findOrCreatePayee(t.merchant);
          db.update(transactions).set({ payeeId: payee.id, payeeLocked: 1 }).where(eq(transactions.id, t.id)).run();
        }
      }
    });
    setFlag("payeesMigrated");
  }

  recomputeAll();
}

// ── Preview ───────────────────────────────────────────────────────

export function previewAlias(pattern: string, match: string, amount: number | null) {
  const alias = { pattern, match, amount };
  const payeeName = new Map(db.select().from(payees).all().map((p) => [p.id, p.name]));
  const hits = db
    .select()
    .from(transactions)
    .all()
    .filter((t) => aliasMatches(alias, t))
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    count: hits.length,
    total: round(hits.reduce((s, t) => s + t.amount, 0)),
    merchants: [...new Set(hits.map((t) => t.baseMerchant || t.merchant))].slice(0, 12),
    samples: hits.slice(0, 8).map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      amount: t.amount,
      payee: t.payeeId ? payeeName.get(t.payeeId) ?? null : null,
    })),
  };
}

// ── Lists ─────────────────────────────────────────────────────────

const isCost = (t: Transaction) => t.amount < 0 && (t.kind === "spend" || t.kind === "fee" || t.kind === "interest");
/** Money coming in from outside: income, refunds, interest earned (not moves between your own accounts) */
const isIncoming = (t: Transaction) => t.amount > 0 && t.kind !== "transfer";

export function listPayees() {
  const all = db.select().from(transactions).all();
  const aliases = db.select().from(payeeAliases).all();
  const byPayee = new Map<string, Transaction[]>();
  const byAlias = new Map<string, number>();
  for (const t of all) {
    if (t.payeeId) (byPayee.get(t.payeeId) ?? byPayee.set(t.payeeId, []).get(t.payeeId)!).push(t);
    if (t.aliasId) byAlias.set(t.aliasId, (byAlias.get(t.aliasId) || 0) + 1);
  }
  return db
    .select()
    .from(payees)
    .all()
    .map((p) => {
      const rows = byPayee.get(p.id) ?? [];
      return {
        ...p,
        count: rows.length,
        spent: round(rows.filter(isCost).reduce((s, t) => s - t.amount, 0)),
        received: round(rows.filter(isIncoming).reduce((s, t) => s + t.amount, 0)),
        lastDate: rows.reduce((m, t) => (t.date > m ? t.date : m), "") || null,
        aliases: aliases.filter((a) => a.payeeId === p.id).map((a) => ({ ...a, matched: byAlias.get(a.id) || 0 })),
        handPicked: rows.filter((t) => t.payeeLocked).length,
      };
    })
    .sort((a, b) => b.spent - a.spent || b.received - a.received || a.name.localeCompare(b.name));
}

/** "2026-03" shifted by n months */
function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function payeeDetail(id: string) {
  const payee = listPayees().find((p) => p.id === id);
  if (!payee) return null;
  const rows = db.select().from(transactions).where(eq(transactions.payeeId, id)).all().sort((a, b) => b.date.localeCompare(a.date));
  const monthly = new Map<string, { amount: number; received: number }>();
  for (const t of rows) {
    if (!isCost(t) && !isIncoming(t)) continue;
    const m = monthly.get(t.month) ?? monthly.set(t.month, { amount: 0, received: 0 }).get(t.month)!;
    if (isCost(t)) m.amount -= t.amount;
    else m.received += t.amount;
  }

  // Each bank name with how many transactions carry it and what files them here:
  // the alias that catches most of them, or none when they were picked by hand
  const names = new Map<string, { name: string; count: number; byAlias: Map<string, number>; handPicked: number }>();
  for (const t of rows) {
    const name = t.baseMerchant || t.merchant;
    const n = names.get(name) ?? names.set(name, { name, count: 0, byAlias: new Map(), handPicked: 0 }).get(name)!;
    n.count++;
    if (t.aliasId) n.byAlias.set(t.aliasId, (n.byAlias.get(t.aliasId) || 0) + 1);
    else n.handPicked++;
  }

  // Transactions for the 12 months ending with the payee's latest one, the span the chart shows
  const latest = rows[0]?.month;
  const from = latest ? shiftMonth(latest, -11) : "";

  return {
    ...payee,
    monthly: [...monthly].map(([month, m]) => ({ month, amount: round(m.amount), received: round(m.received) })).sort((a, b) => a.month.localeCompare(b.month)),
    bankNames: [...names.values()]
      .map(({ name, count, byAlias, handPicked }) => ({
        name,
        count,
        aliasId: [...byAlias].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        handPicked,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    recent: rows.filter((t) => t.month >= from).slice(0, 500).map(({ raw: _raw, ...t }) => t),
  };
}

/** Bank names with no payee yet, biggest spend first, then biggest money in */
export function unassignedMerchants() {
  const groups = new Map<string, { key: string; merchant: string; count: number; spent: number; received: number; lastDate: string; samples: string[]; kinds: Set<string> }>();
  for (const t of db.select().from(transactions).all()) {
    if (t.payeeId || t.kind === "transfer") continue;
    const name = t.baseMerchant || t.merchant;
    const key = merchantKey(name);
    const g = groups.get(key) ?? { key, merchant: name, count: 0, spent: 0, received: 0, lastDate: "", samples: [], kinds: new Set() };
    g.count++;
    if (isCost(t)) g.spent -= t.amount;
    if (isIncoming(t)) g.received += t.amount;
    if (t.date > g.lastDate) g.lastDate = t.date;
    if (g.samples.length < 3 && !g.samples.includes(t.description)) g.samples.push(t.description);
    g.kinds.add(t.kind);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ kinds, ...g }) => ({ ...g, spent: round(g.spent), received: round(g.received), kinds: [...kinds] }))
    .sort((a, b) => b.spent - a.spent || b.received - a.received || b.count - a.count);
}

/**
 * The transactions behind one "No payee yet" bank name (same key and filter as
 * unassignedMerchants), newest first. limit caps the rows; total is the full count.
 */
export function unassignedTransactions(key: string, limit?: number) {
  const accountName = new Map(db.select().from(statementAccounts).all().map((a) => [a.id, a.name]));
  const rows = db
    .select()
    .from(transactions)
    .all()
    .filter((t) => !t.payeeId && t.kind !== "transfer" && merchantKey(t.baseMerchant || t.merchant) === key)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return {
    total: rows.length,
    rows: rows.slice(0, limit && limit > 0 ? limit : undefined).map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      accountId: t.accountId,
      account: accountName.get(t.accountId) ?? t.accountId,
      amount: t.amount,
      kind: t.kind,
    })),
  };
}

// ── Suggestions ───────────────────────────────────────────────────

const STOP = new Set([
  "the", "and", "www", "inc", "llc", "corp", "payment", "purchase", "online", "store", "stores", "debit", "credit",
  "card", "pos", "ach", "check", "deposit", "withdrawal", "transfer", "recurring", "bill", "mobile", "autopay",
  "monthly", "service", "services", "company", "intl", "international", "market", "usa",
]);

function firstToken(name: string): string | null {
  for (const w of name.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)) return w;
  }
  return null;
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface SuggestionMember {
  /** "p:<payeeId>" for a payee, "m:<merchantKey>" for an unassigned bank name */
  key: string;
  name: string;
  payeeId: string | null;
  count: number;
  spent: number;
  received: number;
}

export interface Suggestion {
  id: string;
  reason: string;
  name: string;
  members: SuggestionMember[];
}

function dismissed(): Set<string> {
  const row = db.select().from(settings).where(eq(settings.key, "payeeSuggestionsDismissed")).get();
  return new Set(row ? (JSON.parse(row.value) as string[]) : []);
}

export function dismissSuggestion(id: string) {
  const set = dismissed();
  set.add(id);
  const value = JSON.stringify([...set]);
  db.insert(settings).values({ key: "payeeSuggestionsDismissed", value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

export function suggestions(): Suggestion[] {
  const all = db.select().from(transactions).all().filter((t) => t.kind !== "transfer");
  const payeeById = new Map(db.select().from(payees).all().map((p) => [p.id, p]));

  // One group per payee and per unassigned bank name
  const groups = new Map<string, SuggestionMember & { rows: Transaction[] }>();
  for (const t of all) {
    const key = t.payeeId ? `p:${t.payeeId}` : `m:${merchantKey(t.baseMerchant || t.merchant)}`;
    const g = groups.get(key) ?? {
      key,
      name: t.payeeId ? payeeById.get(t.payeeId)?.name ?? t.merchant : t.baseMerchant || t.merchant,
      payeeId: t.payeeId,
      count: 0,
      spent: 0,
      received: 0,
      rows: [],
    };
    g.count++;
    if (isCost(t)) g.spent = round(g.spent - t.amount);
    if (isIncoming(t)) g.received = round(g.received + t.amount);
    g.rows.push(t);
    groups.set(key, g);
  }
  const member = ({ rows: _rows, ...m }: SuggestionMember & { rows: Transaction[] }): SuggestionMember => m;
  const skip = dismissed();
  const out: Suggestion[] = [];
  const signature = (members: { key: string }[]) => members.map((m) => m.key).sort().join("|");

  // 1. Names that share their first meaningful word: "Amazon Mktpl", "Amazon.com", "Amzn"… (at most one payee)
  const byToken = new Map<string, (SuggestionMember & { rows: Transaction[] })[]>();
  for (const g of groups.values()) {
    const tok = firstToken(g.name);
    if (tok) (byToken.get(tok) ?? byToken.set(tok, []).get(tok)!).push(g);
  }
  for (const [tok, members] of byToken) {
    if (members.length < 2) continue;
    const payeeMembers = members.filter((m) => m.payeeId);
    if (payeeMembers.length > 1) continue; // Already split on purpose
    const sorted = [...members].sort((a, b) => b.count - a.count);
    const id = `tok:${signature(sorted)}`;
    if (skip.has(id)) continue;
    out.push({
      id,
      reason: `All start with “${tok}”`,
      name: payeeMembers[0]?.name ?? tok.charAt(0).toUpperCase() + tok.slice(1),
      members: sorted.map(member),
    });
  }

  // 2. A recurring charge that changed its name: same amount and rhythm, one stops as the other starts
  const recurring = [...groups.values()]
    .map((g) => {
      const rows = g.rows.filter(isCost).sort((a, b) => a.date.localeCompare(b.date));
      if (rows.length < 2) return null;
      const gaps = rows.slice(1).map((t, i) => dayNumber(t.date) - dayNumber(rows[i].date));
      const gap = median(gaps);
      if (gap < 25 || gap > 36) return null;
      return { g, first: rows[0].date, last: rows[rows.length - 1].date, amount: median(rows.map((t) => -t.amount)) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  for (const a of recurring) {
    for (const b of recurring) {
      if (a === b || a.last >= b.first) continue;
      const handoff = dayNumber(b.first) - dayNumber(a.last);
      if (handoff < 15 || handoff > 50) continue;
      if (Math.abs(a.amount - b.amount) > Math.max(1, a.amount * 0.05)) continue;
      if (a.g.payeeId && b.g.payeeId) continue;
      const members = [b.g, a.g];
      const id = `ren:${signature(members)}`;
      if (skip.has(id) || out.some((s) => signature(s.members) === signature(members))) continue;
      out.push({
        id,
        reason: `Same ~$${a.amount.toFixed(2)} monthly charge: “${a.g.name}” stopped ${a.last}, “${b.g.name}” started ${b.first}`,
        name: (a.g.payeeId ? a.g.name : b.g.payeeId ? b.g.name : b.g.name),
        members: members.map(member),
      });
    }
  }

  return out.sort((x, y) => y.members.reduce((s, m) => s + m.spent, 0) - x.members.reduce((s, m) => s + m.spent, 0));
}

// ── Merge ─────────────────────────────────────────────────────────

/**
 * Put several payees and/or unassigned bank names under one payee.
 * Bank names become "merchant" aliases; other payees are folded in (aliases moved, payee removed).
 */
export function mergeInto(target: { payeeId?: string; name?: string; category?: string | null }, memberKeys: string[]) {
  let payee: Payee | undefined = target.payeeId ? db.select().from(payees).where(eq(payees.id, target.payeeId)).get() : undefined;
  if (!payee) {
    if (!target.name?.trim()) throw new Error("Pick a payee or give the new one a name");
    payee = findOrCreatePayee(target.name, { category: target.category || null });
  }
  const unassigned = new Map(unassignedMerchants().map((u) => [`m:${u.key}`, u]));

  db.transaction((tx) => {
    for (const key of memberKeys) {
      if (key.startsWith("p:")) {
        const otherId = key.slice(2);
        if (otherId === payee!.id) continue;
        const other = tx.select().from(payees).where(eq(payees.id, otherId)).get();
        if (!other) continue;
        tx.update(payeeAliases).set({ payeeId: payee!.id }).where(eq(payeeAliases.payeeId, otherId)).run();
        tx.update(transactions).set({ payeeId: payee!.id }).where(eq(transactions.payeeId, otherId)).run();
        if (!payee!.billId && other.billId) tx.update(payees).set({ billId: other.billId }).where(eq(payees.id, payee!.id)).run();
        if (!payee!.category && other.category) tx.update(payees).set({ category: other.category }).where(eq(payees.id, payee!.id)).run();
        tx.delete(payees).where(eq(payees.id, otherId)).run();
      } else if (key.startsWith("m:")) {
        const u = unassigned.get(key);
        if (u) addAlias(payee!.id, u.merchant, "merchant");
      }
    }
  });
  recomputeAll();
  return payee;
}

/** Remove a payee: its transactions go back to what the bank said */
export function deletePayee(id: string) {
  db.transaction((tx) => {
    tx.delete(payeeAliases).where(eq(payeeAliases.payeeId, id)).run();
    tx.update(transactions).set({ payeeId: null, payeeLocked: 0, aliasId: null }).where(eq(transactions.payeeId, id)).run();
    tx.delete(payees).where(eq(payees.id, id)).run();
  });
  recomputeAll();
}
