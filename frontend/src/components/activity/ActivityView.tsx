import { useCallback, useEffect, useMemo, useState } from "react";
import SearchInput from "../layout/SearchInput";
import { api } from "../../lib/api";
import { fmt, fmtDate, fmtP, moLabel } from "../../lib/formatters";
import StatCard from "../layout/StatCard";
import LoadingState from "../layout/LoadingState";
import ImportButton from "./ImportButton";
import TransactionEditModal from "./TransactionEditModal";
import MerchantsTab from "./MerchantsTab";
import MergeModal, { type MergeMember } from "./MergeModal";
import PayeeModal from "./PayeeModal";
import {
  Badge, Card, Empty, KIND_BADGE, KIND_LABELS, 
} from "./shared";
import type { Insights, Payee, StatementAccount, Transaction, TxnKind } from "../../types";

interface ActivityViewProps {
  onToast: (msg: string, err?: boolean) => void;
}

type Tab = "overview" | "merchants" | "all";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "merchants", label: "Merchants" },
  { id: "all", label: "Transactions" },
];
const TAB_KEY = "activity.tab";

function storedTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY) as Tab | null;
    return v && TABS.some((t) => t.id === v) ? v : "overview";
  } catch {
    return "overview";
  }
}

export default function ActivityView({ onToast }: ActivityViewProps) {
  const [tab, setTab] = useState<Tab>(storedTab);
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [accounts, setAccounts] = useState<StatementAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [openPayee, setOpenPayee] = useState<string | null>(null);
  const [merging, setMerging] = useState<{ members: MergeMember[]; name?: string } | null>(null);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  /** Bumped after each successful grouping, so Merchants can reset its searches */
  const [groupings, setGroupings] = useState(0);

  useEffect(() => {
    Promise.all([api.transactions.insights(month), api.transactions.accounts(), api.payees.list()])
      .then(([i, a, p]) => {
        setInsights(i);
        setAccounts(a);
        setPayees(p);
      })
      .catch((err) => onToast(err instanceof Error ? err.message : "Failed to load", true))
      .finally(() => setLoading(false));
  }, [month, version, onToast]);

  function pick(t: Tab) {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // Preference just won't stick
    }
  }

  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const categories = useMemo(
    () =>
      [
        ...new Set(
          (insights?.byCategory ?? [])
            .map((c) => c.category)
            .concat(payees.map((p) => p.category ?? "").filter(Boolean))
            .concat("Uncategorized")
        ),
      ].sort(),
    [insights, payees]
  );

  if (loading) return <LoadingState />;

  const empty = !insights || insights.months.length === 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h2 className="text-[22px] font-semibold">Activity</h2>
        <div className="flex items-center gap-2">
          {!empty && (tab === "overview" || tab === "all") && (
            <select
              value={insights!.month}
              onChange={(e) => setMonth(e.target.value)}
              className="!w-auto !text-sm !py-1.5 !px-3"
            >
              {insights!.months.map((m) => <option key={m} value={m}>{moLabel(m)}</option>)}
            </select>
          )}
          <ImportButton onToast={onToast} onChanged={reload} />
        </div>
      </div>

      {empty ? (
        <div className="text-center py-12 text-text-dim">
          <div className="text-4xl mb-3 opacity-40">🧾</div>
          <p className="text-sm mb-1">No transactions yet.</p>
          <p className="text-xs text-text-muted">
            Download CSV exports or PDF statements from your bank and card sites, then tap Import.
          </p>
        </div>
      ) : (
        <>
          {/* Every tab fits, so phones get the same bar at full width */}
          <div className="flex max-md:grid max-md:grid-cols-3 gap-0.5 p-0.5 bg-bg-card border border-border rounded-lg mb-5 w-fit max-md:w-full">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => pick(t.id)}
                className={`px-3 max-md:px-1 py-1.5 max-md:py-2 rounded-md text-xs font-medium whitespace-nowrap truncate transition-all ${
                  tab === t.id ? "text-accent bg-accent/[0.1]" : "text-text-dim hover:text-text"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" && <Overview insights={insights!} />}
          {tab === "merchants" && (
            <MerchantsTab
              payees={payees}
              version={version}
              groupings={groupings}
              onOpenPayee={setOpenPayee}
              onMerge={(members, name) => setMerging({ members, name })}
              onToast={onToast}
            />
          )}
          {tab === "all" && (
            <AllTransactions
              month={insights!.month}
              accounts={accounts}
              accountName={accountName}
              version={version}
              onEdit={setEditing}
            />
          )}
        </>
      )}

      <TransactionEditModal
        txn={editing}
        payees={payees}
        categories={categories}
        onClose={() => setEditing(null)}
        onSaved={reload}
        onToast={onToast}
      />
      <PayeeModal
        payeeId={openPayee}
        categories={categories}
        onClose={() => setOpenPayee(null)}
        onChanged={reload}
        onToast={onToast}
      />
      <MergeModal
        members={merging?.members ?? null}
        suggestedName={merging?.name}
        payees={payees}
        categories={categories}
        onClose={() => setMerging(null)}
        onDone={() => { reload(); setGroupings((n) => n + 1); }}
        onToast={onToast}
      />
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────

function Delta({ now, before, goodWhenDown, partial }: { now: number; before: number | undefined; goodWhenDown?: boolean; partial?: boolean }) {
  if (before == null || before === 0) return null;
  const d = now - before;
  if (Math.abs(d) < 1) return null;
  const good = goodWhenDown ? d < 0 : d > 0;
  return (
    <span className={`text-[11px] font-mono ${good ? "text-green" : "text-red"}`}>
      {d > 0 ? "▲" : "▼"} {fmt(Math.abs(d))} vs {partial ? "same point last month" : "last month"}
    </span>
  );
}

function Bars({ rows }: { rows: { label: string; amount: number; sub?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.amount), 1);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between gap-3 text-xs mb-1">
            <span className="truncate">{r.label}{r.sub && <span className="text-text-muted"> · {r.sub}</span>}</span>
            <span className="font-mono shrink-0">{fmtP(r.amount)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(r.amount / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Overview({ insights }: { insights: Insights }) {
  const { summary: s, prevSummary: p } = insights;
  const paychecks = insights.paychecks.slice(0, 6);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-4 max-lg:grid-cols-2 gap-5 max-md:gap-3">
        <div className="flex flex-col gap-1">
          <StatCard label="Spent" value={fmt(s.netSpent)} color="amber" />
          <Delta now={s.netSpent} before={p?.netSpent} goodWhenDown partial={insights.partial} />
        </div>
        <div className="flex flex-col gap-1">
          <StatCard label="Income" value={fmt(s.income)} color="green" />
          <Delta now={s.income} before={p?.income} partial={insights.partial} />
        </div>
        <StatCard label="Net" value={fmt(s.net)} color="blue" />
        <StatCard label="Fees + interest" value={fmt(s.fees + s.interest)} color="purple" />
      </div>
      <div className="text-[11px] text-text-muted -mt-2">
        {s.count} transactions in {moLabel(insights.month)}{insights.partial && <> (through {fmtDate(insights.asOf)})</>} · {s.transfersExcluded} transfers between your accounts left out so
        nothing is counted twice{s.refunds > 0 && <> · {fmtP(s.refunds)} in refunds subtracted</>}
      </div>

      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-5">
        <Card title="By category">
          {insights.byCategory.length ? (
            <Bars rows={insights.byCategory.slice(0, 10).map((c) => ({ label: c.category, amount: c.amount }))} />
          ) : <Empty>No spending this month.</Empty>}
        </Card>
        <Card title="Top merchants">
          {insights.topMerchants.length ? (
            <Bars rows={insights.topMerchants.slice(0, 10).map((m) => ({ label: m.merchant, amount: m.amount, sub: `${m.count}×` }))} />
          ) : <Empty>No spending this month.</Empty>}
        </Card>
        <Card title="By account">
          {insights.byAccount.length ? (
            <Bars rows={insights.byAccount.map((a) => ({ label: a.name, amount: a.spent, sub: `${a.count}` }))} />
          ) : <Empty>No spending this month.</Empty>}
        </Card>
        <Card
          title="Paychecks"
          extra={insights.expectedPaycheck > 0 && (
            <span className="text-[11px] text-text-muted">Settings: <span className="font-mono">{fmtP(insights.expectedPaycheck)}</span></span>
          )}
        >
          {paychecks.length ? (
            <div className="flex flex-col">
              {paychecks.map((pc) => {
                const diff = insights.expectedPaycheck ? pc.amount - insights.expectedPaycheck : 0;
                return (
                  <div key={pc.id} className="flex justify-between gap-3 text-xs py-1.5 border-b border-border/30 last:border-0">
                    <span>{fmtDate(pc.date)}</span>
                    <span className="flex gap-3 items-baseline">
                      {Math.abs(diff) >= 1 && (
                        <span className={`font-mono text-[11px] ${diff > 0 ? "text-green" : "text-red"}`}>
                          {diff > 0 ? "+" : "−"}{fmtP(Math.abs(diff))}
                        </span>
                      )}
                      <span className="font-mono">{fmtP(pc.amount)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : <Empty>No deposits that look like payroll yet.</Empty>}
        </Card>
      </div>
    </div>
  );
}

// ── All transactions ──────────────────────────────────────────────

function AllTransactions({
  month, accounts, accountName, version, onEdit,
}: {
  month: string;
  accounts: StatementAccount[];
  accountName: Map<string, string>;
  version: number;
  onEdit: (t: Transaction) => void;
}) {
  const [account, setAccount] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [allMonths, setAllMonths] = useState(false);
  const [rows, setRows] = useState<Transaction[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.transactions
        .list({ month: allMonths ? undefined : month, account, kind, q, limit: 2000 })
        .then(setRows)
        .catch(() => setRows([]));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [month, account, kind, q, allMonths, version]);

  const total = (rows ?? []).reduce((s, t) => s + t.amount, 0);

  return (
    <div>
      <div className="flex gap-2 flex-wrap mb-4">
        <SearchInput placeholder="Search merchant, description, category" value={q} onChange={setQ} className="flex-1 min-w-[min(100%,21rem)] max-w-md" />
        <select value={account} onChange={(e) => setAccount(e.target.value)} className="!w-auto !text-sm !py-1.5">
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="!w-auto !text-sm !py-1.5">
          <option value="">All types</option>
          {(Object.keys(KIND_LABELS) as TxnKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-text-dim cursor-pointer">
          <input type="checkbox" checked={allMonths} onChange={(e) => setAllMonths(e.target.checked)} />
          All months
        </label>
        {rows && (
          <span className="ml-auto self-center text-xs text-text-muted">
            {rows.length} shown · net <span className="font-mono text-text">{fmtP(total)}</span>
          </span>
        )}
      </div>

      {rows === null ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <Empty>No matching transactions.</Empty>
      ) : (
        <div className="bg-bg-card border border-border rounded-xl divide-y divide-border/40">
          {rows.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.02]" onClick={() => onEdit(t)}>
              <span className="text-xs text-text-muted w-[84px] shrink-0 max-md:hidden">{fmtDate(t.date)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm truncate">{t.merchant}</span>
                  {t.kind !== "spend" && <Badge className={KIND_BADGE[t.kind]}>{KIND_LABELS[t.kind].replace(" (own accounts)", "")}</Badge>}
                </div>
                <div className="text-[11px] text-text-muted truncate">
                  <span className="md:hidden">{fmtDate(t.date)} · </span>
                  {t.category} · {accountName.get(t.accountId) || t.accountId}
                  {t.member && <> · {t.member}</>}
                </div>
              </div>
              <span className={`font-mono text-sm shrink-0 ${t.amount > 0 ? "text-green" : ""} ${t.kind === "transfer" ? "text-text-muted" : ""}`}>
                {fmtP(t.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
