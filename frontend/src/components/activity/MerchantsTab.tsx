import { Fragment, useEffect, useMemo, useState } from "react";
import SearchInput from "../layout/SearchInput";
import { api } from "../../lib/api";
import { fmtDate } from "../../lib/formatters";
import { Badge, Card, Empty, money, moneyInNote } from "./shared";
import type { MergeMember } from "./MergeModal";
import type { Payee, PayeeSuggestion, UnassignedMerchant } from "../../types";

interface Props {
  payees: Payee[];
  version: number;
  onOpenPayee: (id: string) => void;
  onMerge: (members: MergeMember[], suggestedName?: string) => void;
  onToast: (msg: string, err?: boolean) => void;
}

// ── Sorting ──────────────────────────────────────────────────────
const PAYEE_SORTS = [
  { id: "spent", label: "Most spent" },
  { id: "recent", label: "Recent" },
  { id: "count", label: "Most frequent" },
  { id: "name", label: "Name A–Z" },
  { id: "newest", label: "Newest" },
] as const;
const OPEN_SORTS = [
  { id: "spent", label: "Most spent" },
  { id: "count", label: "Most frequent" },
  { id: "recent", label: "Recent" },
  { id: "name", label: "Name A–Z" },
] as const;
type PayeeSort = (typeof PAYEE_SORTS)[number]["id"];
type OpenSort = (typeof OPEN_SORTS)[number]["id"];
const PAYEE_SORT_KEY = "merchants.payees.sort";
const OPEN_SORT_KEY = "merchants.unassigned.sort";

function stored<T extends string>(key: string, options: readonly { id: T }[]): T {
  try {
    const v = localStorage.getItem(key);
    const hit = options.find((o) => o.id === v);
    if (hit) return hit.id;
  } catch {
    // Storage unavailable: fall back to the default
  }
  return options[0].id;
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the choice just won't stick
  }
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
/** Newest first; rows with no date go last */
const byDateDesc = (a: string | null, b: string | null) => (b ?? "").localeCompare(a ?? "");

function sortPayees(list: Payee[], sort: PayeeSort): Payee[] {
  const key = (a: Payee, b: Payee) =>
    sort === "spent" ? b.spent - a.spent || b.received - a.received
    : sort === "count" ? b.count - a.count
    : sort === "recent" ? byDateDesc(a.lastDate, b.lastDate)
    : sort === "newest" ? byDateDesc(a.createdAt, b.createdAt)
    : 0;
  return [...list].sort((a, b) => key(a, b) || byName(a.name, b.name) || a.id.localeCompare(b.id));
}

function sortOpen(list: UnassignedMerchant[], sort: OpenSort): UnassignedMerchant[] {
  const key = (a: UnassignedMerchant, b: UnassignedMerchant) =>
    sort === "spent" ? b.spent - a.spent || b.received - a.received
    : sort === "count" ? b.count - a.count
    : sort === "recent" ? byDateDesc(a.lastDate, b.lastDate)
    : 0;
  return [...list].sort((a, b) => key(a, b) || byName(a.merchant, b.merchant) || a.key.localeCompare(b.key));
}

/** Compact sort picker that sits beside a list's search box */
function SortSelect<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="relative shrink-0">
      <select
        aria-label={label}
        title={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="!w-[110px] !text-xs !py-1.5 !pl-2.5 !pr-6 h-full cursor-pointer"
      >
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-muted">▾</span>
    </div>
  );
}

/** Right-hand row figure: the sorted-by value on top, secondary figures under it */
function RowStat({ main, sub = [] }: { main: React.ReactNode; sub?: React.ReactNode[] }) {
  const parts = sub.filter((x) => x != null && x !== "");
  return (
    <span className="text-right shrink-0">
      <span className="block font-mono text-xs whitespace-nowrap">{main}</span>
      {parts.length > 0 && (
        <span className="block text-[10px] text-text-muted whitespace-nowrap">
          {parts.map((x, i) => <Fragment key={i}>{i > 0 && " · "}{x}</Fragment>)}
        </span>
      )}
    </span>
  );
}

/** "Oct 27" this year, "Oct 27, 2025" otherwise: keeps the date column narrow on phones */
function shortDate(ds: string): string {
  const full = fmtDate(ds);
  return ds.startsWith(String(new Date().getFullYear())) ? full.replace(/, \d{4}$/, "") : full;
}

function payeeStat(p: Payee, sort: PayeeSort): { main: React.ReactNode; sub?: React.ReactNode[] } {
  const amount = money(p.spent, p.received);
  const extra = moneyInNote(p.spent, p.received);
  if (sort === "recent") return { main: p.lastDate ? shortDate(p.lastDate) : "—", sub: [amount, extra] };
  if (sort === "count") return { main: `${p.count}×`, sub: [amount, extra] };
  if (sort === "newest") return { main: shortDate(p.createdAt.slice(0, 10)), sub: ["added"] };
  return { main: amount, sub: [extra] };
}

function openStat(u: UnassignedMerchant, sort: OpenSort): { main: React.ReactNode; sub?: React.ReactNode[] } {
  const amount = money(u.spent, u.received);
  const extra = moneyInNote(u.spent, u.received);
  if (sort === "recent") return { main: shortDate(u.lastDate), sub: [amount, extra] };
  if (sort === "count") return { main: `${u.count}×`, sub: [amount, extra] };
  return { main: amount, sub: [`${u.count}×`, extra] };
}

export default function MerchantsTab({ payees, version, onOpenPayee, onMerge, onToast }: Props) {
  const [suggestions, setSuggestions] = useState<PayeeSuggestion[] | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedMerchant[] | null>(null);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qPayees, setQPayees] = useState("");
  const [qUnassigned, setQUnassigned] = useState("");
  const [payeeSort, setPayeeSort] = useState<PayeeSort>(() => stored(PAYEE_SORT_KEY, PAYEE_SORTS));
  const [openSort, setOpenSort] = useState<OpenSort>(() => stored(OPEN_SORT_KEY, OPEN_SORTS));

  useEffect(() => {
    api.payees.suggestions().then(setSuggestions).catch(() => setSuggestions([]));
    api.payees.unassigned().then(setUnassigned).catch(() => setUnassigned([]));
    setSelected(new Set());
  }, [version]);

  // Search first, then sort what's left
  const filteredPayees = useMemo(
    () => sortPayees(payees.filter((p) => !qPayees || p.name.toLowerCase().includes(qPayees.toLowerCase()) || p.aliases.some((a) => a.pattern.toLowerCase().includes(qPayees.toLowerCase()))), payeeSort),
    [payees, qPayees, payeeSort]
  );
  const filteredUnassigned = useMemo(
    () => sortOpen((unassigned ?? []).filter((u) => !qUnassigned || u.merchant.toLowerCase().includes(qUnassigned.toLowerCase()) || u.samples.some((s) => s.toLowerCase().includes(qUnassigned.toLowerCase()))), openSort),
    [unassigned, qUnassigned, openSort]
  );

  function toggle(key: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function dismiss(s: PayeeSuggestion) {
    try {
      await api.payees.dismissSuggestion(s.id);
      setSuggestions((list) => list?.filter((x) => x.id !== s.id) ?? null);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed", true);
    }
  }

  const shownSuggestions = showAllSuggestions ? suggestions ?? [] : (suggestions ?? []).slice(0, 4);
  const assignedShare = useMemo(() => {
    const assigned = payees.reduce((s, p) => s + p.spent, 0);
    const rest = (unassigned ?? []).reduce((s, u) => s + u.spent, 0);
    if (assigned + rest <= 0) return "0%";
    const pct = (assigned / (assigned + rest)) * 100;
    return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
  }, [payees, unassigned]);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-text-muted -mb-1">
        A payee is the one name you want to see for a merchant, however it shows up on statements. Group bank names under
        a payee here, or from any transaction. {payees.length > 0 && <>Payees cover <span className="text-text">{assignedShare}</span> of your spending so far.</>}
      </p>

      {suggestions && suggestions.length > 0 && (
        <Card
          title={`Suggested groups (${suggestions.length})`}
          extra={suggestions.length > 4 && (
            <button className="text-xs text-accent" onClick={() => setShowAllSuggestions((v) => !v)}>
              {showAllSuggestions ? "Show fewer" : "Show all"}
            </button>
          )}
        >
          <div className="flex flex-col gap-3">
            {shownSuggestions.map((s) => (
              <div key={s.id} className="border border-border rounded-lg p-3">
                <div className="text-[11px] text-text-muted mb-2">{s.reason}</div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {s.members.map((m) => (
                    <span key={m.key} className={`text-xs px-2 py-0.5 rounded-md border ${m.payeeId ? "border-accent/40 text-accent" : "border-border text-text-dim"}`}>
                      {m.name} <span className="text-text-muted">· {m.count}× · {money(m.spent, m.received)}</span>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 justify-end">
                  <button className="btn btn-sm" onClick={() => dismiss(s)}>Not the same</button>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => onMerge(s.members.map((m) => ({ key: m.key, name: m.name, count: m.count, spent: m.spent, received: m.received })), s.name)}
                  >
                    Group…
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-5">
        <Card title={`Payees (${payees.length})`}>
          <div className="flex gap-2 mb-2">
            <SearchInput placeholder="Search payee or alias" value={qPayees} onChange={setQPayees} className="flex-1 min-w-0" />
            <SortSelect
              label="Sort payees"
              value={payeeSort}
              options={PAYEE_SORTS}
              onChange={(v) => { setPayeeSort(v); remember(PAYEE_SORT_KEY, v); }}
            />
          </div>
          {filteredPayees.length === 0 ? (
            <Empty>{payees.length ? "No match." : "No payees yet. Group a suggestion or pick bank names under No payee yet."}</Empty>
          ) : (
            <div className="flex flex-col max-h-[520px] scroll-list">
              {filteredPayees.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onOpenPayee(p.id)}
                  className="flex items-center gap-3 text-left py-2 px-1 border-b border-border/30 last:border-0 hover:bg-white/[0.02]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm truncate">{p.name}</span>
                      {p.billId && <Badge className="bg-white/[0.06] text-text-dim">Bill</Badge>}
                    </div>
                    <div className="text-[11px] text-text-muted truncate">
                      {p.category ?? "Bank category"} · {p.aliases.length} alias{p.aliases.length === 1 ? "" : "es"} · {p.count}×
                      {p.lastDate && <> · last {fmtDate(p.lastDate)}</>}
                    </div>
                  </div>
                  <RowStat {...payeeStat(p, payeeSort)} />
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card
          title={`No payee yet (${unassigned?.length ?? "…"})`}
          extra={selected.size > 0 && (
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                const members = (unassigned ?? []).filter((u) => selected.has(u.key)).map((u) => ({ key: `m:${u.key}`, name: u.merchant, count: u.count, spent: u.spent, received: u.received }));
                onMerge(members);
              }}
            >
              {selected.size === 1 ? "Name it…" : `Group ${selected.size}…`}
            </button>
          )}
        >
          <div className="flex gap-2 mb-2">
            <SearchInput placeholder="Search bank names" value={qUnassigned} onChange={setQUnassigned} className="flex-1 min-w-0" />
            <SortSelect
              label="Sort bank names"
              value={openSort}
              options={OPEN_SORTS}
              onChange={(v) => { setOpenSort(v); remember(OPEN_SORT_KEY, v); }}
            />
          </div>
          {unassigned === null ? (
            <Empty>Loading…</Empty>
          ) : filteredUnassigned.length === 0 ? (
            <Empty>{unassigned.length ? "No match." : "Everything has a payee."}</Empty>
          ) : (
            <div className="flex flex-col max-h-[520px] scroll-list">
              {filteredUnassigned.slice(0, 300).map((u) => (
                <label key={u.key} className="flex items-center gap-3 py-2 px-1 border-b border-border/30 last:border-0 cursor-pointer hover:bg-white/[0.02]">
                  <input type="checkbox" checked={selected.has(u.key)} onChange={() => toggle(u.key)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{u.merchant}</div>
                    <div className="text-[11px] text-text-muted truncate font-mono" title={u.samples.join("\n")}>{u.samples[0]}</div>
                  </div>
                  <RowStat {...openStat(u, openSort)} />
                </label>
              ))}
            </div>
          )}
          {selected.size > 0 && (
            <button className="text-[11px] text-text-muted mt-2 hover:text-text" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          )}
        </Card>
      </div>
    </div>
  );
}
