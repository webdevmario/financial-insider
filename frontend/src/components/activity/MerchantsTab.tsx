import { Fragment, useEffect, useMemo, useState } from "react";
import SearchInput from "../layout/SearchInput";
import { api } from "../../lib/api";
import { fmtDate } from "../../lib/formatters";
import { Badge, Card, Empty, money, moneyInNote, shortDate } from "./shared";
import UnassignedModal from "./UnassignedModal";
import type { MergeMember } from "./MergeModal";
import type { Payee, UnassignedMerchant, UnassignedTxn } from "../../types";

interface Props {
  payees: Payee[];
  version: number;
  /** Goes up after each successful grouping */
  groupings: number;
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

/** Small "list" glyph for the inspect button */
function ListIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M5.5 4h7M5.5 8h7M5.5 12h7" />
      <circle cx="2.75" cy="4" r=".6" fill="currentColor" />
      <circle cx="2.75" cy="8" r=".6" fill="currentColor" />
      <circle cx="2.75" cy="12" r=".6" fill="currentColor" />
    </svg>
  );
}

export default function MerchantsTab({ payees, version, groupings, onOpenPayee, onMerge, onToast }: Props) {
  const [unassigned, setUnassigned] = useState<UnassignedMerchant[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inspecting, setInspecting] = useState<UnassignedMerchant | null>(null);
  const [qPayees, setQPayees] = useState("");
  const [qUnassigned, setQUnassigned] = useState("");
  const [payeeSort, setPayeeSort] = useState<PayeeSort>(() => stored(PAYEE_SORT_KEY, PAYEE_SORTS));
  const [openSort, setOpenSort] = useState<OpenSort>(() => stored(OPEN_SORT_KEY, OPEN_SORTS));

  useEffect(() => {
    api.payees.unassigned().then(setUnassigned).catch(() => setUnassigned([]));
    setSelected(new Set());
  }, [version]);

  // Each grouping starts the next one fresh
  useEffect(() => {
    setQPayees("");
    setQUnassigned("");
  }, [groupings]);

  // Keep the open bank name's header figures current after a refresh
  useEffect(() => {
    setInspecting((cur) => (cur && unassigned?.find((u) => u.key === cur.key)) || cur);
  }, [unassigned]);

  // Search first, then sort what's left
  const filteredPayees = useMemo(
    () => sortPayees(payees.filter((p) => !qPayees || p.name.toLowerCase().includes(qPayees.toLowerCase()) || p.aliases.some((a) => a.pattern.toLowerCase().includes(qPayees.toLowerCase()))), payeeSort),
    [payees, qPayees, payeeSort]
  );
  const filteredUnassigned = useMemo(
    () => sortOpen((unassigned ?? []).filter((u) => !qUnassigned || u.merchant.toLowerCase().includes(qUnassigned.toLowerCase()) || u.samples.some((s) => s.toLowerCase().includes(qUnassigned.toLowerCase()))), openSort),
    [unassigned, qUnassigned, openSort]
  );

  function assignSome(u: UnassignedMerchant, rows: UnassignedTxn[]) {
    onMerge(rows.map((t) => ({ key: `t:${t.id}`, name: t.description, date: t.date, amount: t.amount })), u.merchant);
  }

  function groupAll(u: UnassignedMerchant) {
    setInspecting(null);
    onMerge([{ key: `m:${u.key}`, name: u.merchant, count: u.count, spent: u.spent, received: u.received }]);
  }

  function toggle(key: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }


  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-5">
        <Card title={`Payees (${payees.length})`} actionRow>
          <div className="flex gap-2 mb-3">
            <SearchInput placeholder="Search payee or alias" value={qPayees} onChange={setQPayees} className="flex-1 min-w-0" />
            <SortSelect
              label="Sort payees"
              value={payeeSort}
              options={PAYEE_SORTS}
              onChange={(v) => { setPayeeSort(v); remember(PAYEE_SORT_KEY, v); }}
            />
          </div>
          {filteredPayees.length === 0 ? (
            <Empty>{payees.length ? "No match." : "No payees yet. Pick bank names under No payee yet to group them."}</Empty>
          ) : (
            <div className="flex flex-col max-h-[520px] scroll-well">
              {filteredPayees.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onOpenPayee(p.id)}
                  className="flex items-center gap-3 text-left py-2 px-3 border-b border-border/30 last:border-0 hover:bg-white/[0.02]"
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
          actionRow
          extra={
            // Always laid out (hidden when nothing is picked) so ticking a box never shifts the card
            <div className={`flex items-center gap-3 ${selected.size ? "" : "invisible"}`} aria-hidden={!selected.size}>
              <button className="text-xs text-text-muted hover:text-text" tabIndex={selected.size ? 0 : -1} onClick={() => setSelected(new Set())}>
                Clear
              </button>
              <button
                className="btn btn-sm btn-primary"
                tabIndex={selected.size ? 0 : -1}
                onClick={() => {
                  const members = (unassigned ?? []).filter((u) => selected.has(u.key)).map((u) => ({ key: `m:${u.key}`, name: u.merchant, count: u.count, spent: u.spent, received: u.received }));
                  onMerge(members);
                }}
              >
                {selected.size <= 1 ? "Name it…" : `Group ${selected.size}…`}
              </button>
            </div>
          }
        >
          <div className="flex gap-2 mb-3">
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
            <div className="flex flex-col max-h-[520px] scroll-well">
              {filteredUnassigned.slice(0, 300).map((u) => (
                <div key={u.key} className="flex items-center gap-1 pr-2 border-b border-border/30 last:border-0 hover:bg-white/[0.02]">
                  <label className="flex flex-1 min-w-0 items-center gap-3 py-2 pl-3 cursor-pointer">
                    <input type="checkbox" checked={selected.has(u.key)} onChange={() => toggle(u.key)} aria-label={`Select ${u.merchant}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{u.merchant}</div>
                      <div className="text-[11px] text-text-muted truncate font-mono" title={u.samples.join("\n")}>{u.samples[0]}</div>
                    </div>
                    <RowStat {...openStat(u, openSort)} />
                  </label>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-label={`Inspect transactions for ${u.merchant}`}
                    title="Inspect transactions"
                    onClick={() => setInspecting(u)}
                    className="shrink-0 w-8 h-8 grid place-items-center rounded-md text-text-muted hover:text-text hover:bg-white/[0.05]"
                  >
                    <ListIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <UnassignedModal
        group={inspecting}
        version={version}
        onClose={() => setInspecting(null)}
        onAssign={assignSome}
        onGroupAll={groupAll}
        onToast={onToast}
      />
    </div>
  );
}
