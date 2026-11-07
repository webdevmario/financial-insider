import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "../layout/Modal";
import Confirm from "../layout/Confirm";
import LoadingState from "../layout/LoadingState";
import { api } from "../../lib/api";
import { fmt, fmtDate, fmtP, moLabel } from "../../lib/formatters";
import AliasEditor, { type AliasDraft } from "./AliasEditor";
import { Badge, Empty, KIND_LABELS, MATCH_LABELS, TxnRows } from "./shared";
import type { PayeeDetail, Subscription, TxnKind } from "../../types";

interface Props {
  payeeId: string | null;
  categories: string[];
  onClose: () => void;
  onChanged: () => void;
  onToast: (msg: string, err?: boolean) => void;
}

type Tab = "settings" | "aliases" | "activity";
const TABS: { id: Tab; label: string }[] = [
  { id: "settings", label: "Settings" },
  { id: "aliases", label: "Aliases" },
  { id: "activity", label: "Activity" },
];

const EMPTY_DRAFT: AliasDraft = { pattern: "", match: "contains", amount: null };

export default function PayeeModal({ payeeId, categories, onClose, onChanged, onToast }: Props) {
  const [detail, setDetail] = useState<PayeeDetail | null>(null);
  const [bills, setBills] = useState<Subscription[]>([]);
  const [tab, setTab] = useState<Tab>("settings");
  // The form lives here, not in the tab panels, so switching tabs keeps unsaved edits
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState("");
  const [billId, setBillId] = useState("");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<AliasDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  const fill = useCallback((d: PayeeDetail) => {
    setDetail(d);
    setName(d.name);
    setCategory(d.category ?? "");
    setKind(d.kind ?? "");
    setBillId(d.billId ?? "");
    setNotes(d.notes ?? "");
  }, []);

  useEffect(() => {
    if (!payeeId) return;
    setDetail(null);
    setTab("settings");
    setConfirmingDelete(false);
    setDraft(EMPTY_DRAFT);
    api.payees.get(payeeId).then(fill).catch(() => onToast("Couldn't load payee", true));
    api.subscriptions.list().then(setBills).catch(() => setBills([]));
  }, [payeeId, fill, onToast]);

  if (!payeeId) return null;

  // Alias changes refresh the payee but leave the Settings form alone,
  // so edits made there survive adding or removing an alias
  async function run(fn: () => Promise<PayeeDetail | void>, msg: string) {
    setBusy(true);
    try {
      const d = await fn();
      if (d) setDetail(d);
      onToast(msg);
      onChanged();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed", true);
    } finally {
      setBusy(false);
    }
  }

  const dirty =
    !!detail &&
    (name.trim() !== detail.name ||
      (category.trim() || null) !== detail.category ||
      (kind || null) !== detail.kind ||
      (billId || null) !== detail.billId ||
      (notes.trim() || null) !== detail.notes);

  if (confirmingDelete && detail) {
    return (
      <Confirm
        open
        title={`Delete "${detail.name}"?`}
        message="Its transactions go back to their bank names. Aliases are removed too."
        onConfirm={() => {
          setConfirmingDelete(false);
          run(async () => {
            await api.payees.delete(detail.id);
            onClose();
          }, "Payee deleted");
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    );
  }

  const counts: Partial<Record<Tab, number>> = detail ? { aliases: detail.aliases.length } : {};

  // Left/right arrows move between tabs, as in any tab list
  function onTabKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length].id;
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <Modal
      open={!!payeeId}
      onClose={onClose}
      title={detail?.name ?? "Payee"}
      footer={
        detail && (
          <>
            <button className="btn btn-danger btn-sm mr-auto" disabled={busy} onClick={() => setConfirmingDelete(true)}>
              🗑️ Delete
            </button>
            <button className="btn" onClick={onClose}>{dirty ? "Cancel" : "Close"}</button>
            <button
              className="btn btn-primary"
              disabled={busy || !dirty || !name.trim()}
              onClick={() =>
                run(async () => {
                  await api.payees.update(detail.id, {
                    name: name.trim(),
                    category: category.trim() || null,
                    kind: kind || null,
                    billId: billId || null,
                    notes: notes.trim() || null,
                  });
                  onClose();
                }, "Payee saved")
              }
            >
              Save
            </button>
          </>
        )
      }
    >
      {!detail ? (
        <LoadingState />
      ) : (
        <div className="flex flex-col">
          <div className="text-xs text-text-muted mb-3">
            {detail.count} transactions · {fmt(detail.spent)} spent{detail.lastDate && <> · last {fmtDate(detail.lastDate)}</>}
            {detail.handPicked > 0 && <> · {detail.handPicked} picked by hand</>}
          </div>

          {/* Stays in view while a long tab scrolls under it */}
          <div className="sticky top-0 z-10 bg-bg-card pb-4">
            <div role="tablist" aria-label="Payee sections" className="grid grid-cols-3 gap-0.5 p-0.5 bg-bg border border-border rounded-lg" onKeyDown={onTabKey}>
              {TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    ref={(el) => { tabRefs.current[t.id] = el; }}
                    id={`payee-tab-${t.id}`}
                    role="tab"
                    aria-selected={active}
                    aria-controls={`payee-panel-${t.id}`}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setTab(t.id)}
                    className={`relative px-1 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                      active ? "text-accent bg-accent/[0.1]" : "text-text-dim hover:text-text"
                    }`}
                  >
                    {t.label}
                    {counts[t.id] != null && <span className="ml-1 tabular-nums opacity-60">{counts[t.id]}</span>}
                    {t.id === "settings" && dirty && !active && (
                      <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber" title="Unsaved changes" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div role="tabpanel" id={`payee-panel-${tab}`} aria-labelledby={`payee-tab-${tab}`} className="min-h-[min(440px,55vh)]">
            {tab === "settings" && (
              <div className="flex flex-col gap-3">
                <div className="input-group">
                  <label>Name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
                  <div className="input-group">
                    <label>Type</label>
                    <select value={kind} onChange={(e) => setKind(e.target.value)}>
                      <option value="">Automatic</option>
                      {(Object.keys(KIND_LABELS) as TxnKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                    </select>
                  </div>
                  <div className="input-group">
                    <label>Category</label>
                    <input list="payee-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="What the bank says" />
                    <datalist id="payee-categories">
                      {categories.map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </div>
                </div>
                <div className="input-group">
                  <label>Bill on your Bills list</label>
                  <select value={billId} onChange={(e) => setBillId(e.target.value)}>
                    <option value="">Not a bill</option>
                    {bills.map((b) => <option key={b.id} value={b.id}>{b.name} · {fmtP(b.amount)} {b.frequency}</option>)}
                  </select>
                  <span className="text-[11px] text-text-muted">Linked bills are matched by this payee in Bills check and Recurring, not by name.</span>
                </div>
                <div className="input-group">
                  <label>Notes</label>
                  <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                </div>
              </div>
            )}

            {tab === "aliases" && (
              <div className="flex flex-col gap-5">
                <div>
                  <p className="text-[11px] text-text-muted mb-2">Transactions whose bank text matches an alias are filed under this payee.</p>
                  {detail.aliases.length === 0 ? (
                    <Empty>None. Transactions were picked by hand.</Empty>
                  ) : (
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] gap-x-2 text-xs tabular-nums">
                      {detail.aliases.map((a) => (
                        <div key={a.id} className="grid grid-cols-subgrid col-span-5 items-center py-1.5 border-b border-border/30 last:border-0">
                          <Badge className="bg-white/[0.06] text-text-dim justify-self-start">{MATCH_LABELS[a.match]}</Badge>
                          <span className="font-mono truncate" title={a.pattern}>{a.pattern}</span>
                          <span className="font-mono text-text-muted text-right whitespace-nowrap">{a.amount != null && <>= {fmtP(a.amount)}</>}</span>
                          <span className={`text-right ${a.matched === 0 ? "text-amber" : "text-text-muted"}`} title="Transactions matched">{a.matched}×</span>
                          <button
                            className="text-text-muted hover:text-red px-2 py-1 -my-1"
                            title="Remove alias"
                            aria-label={`Remove alias ${a.pattern}`}
                            disabled={busy}
                            onClick={() => run(() => api.payees.deleteAlias(detail.id, a.id), "Alias removed")}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">Add an alias</div>
                  <AliasEditor value={draft} onChange={setDraft} />
                  <button
                    className="btn btn-sm mt-2"
                    disabled={busy || draft.pattern.trim().length < 3}
                    onClick={() =>
                      run(async () => {
                        const d = await api.payees.addAlias(detail.id, draft);
                        setDraft(EMPTY_DRAFT);
                        return d;
                      }, "Alias added")
                    }
                  >
                    + Add Alias
                  </button>
                </div>

                {detail.bankNames.length > 0 && <BankNames names={detail.bankNames} aliases={detail.aliases} />}
              </div>
            )}

            {tab === "activity" && <Activity detail={detail} />}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Bank names filed under this payee, one per row, with what files them here */
function BankNames({ names, aliases }: { names: PayeeDetail["bankNames"]; aliases: PayeeDetail["aliases"] }) {
  const alias = new Map(aliases.map((a) => [a.id, a]));
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">Seen on statements as</div>
      {names.map((n) => {
        const a = n.aliasId ? alias.get(n.aliasId) : undefined;
        return (
          <div key={n.name} className="flex items-start gap-3 py-1.5 border-b border-border/30 last:border-0 text-xs">
            <div className="min-w-0 flex-1">
              <div className="font-mono break-words">{n.name}</div>
              <div className="text-[11px] text-text-muted mt-0.5">
                {a ? (
                  <>
                    via {MATCH_LABELS[a.match].toLowerCase()} <span className="font-mono text-text-dim">{a.pattern}</span>
                  </>
                ) : (
                  "Picked by hand"
                )}
                {a && n.handPicked > 0 && <> · {n.handPicked} by hand</>}
              </div>
            </div>
            <span className="shrink-0 tabular-nums text-text-muted">{n.count}×</span>
          </div>
        );
      })}
    </div>
  );
}

/** "2026-03" shifted by n months */
function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Spending by month for the 12 months ending with the payee's latest
 * transaction, then those transactions grouped by month. Tapping a bar
 * narrows the list to that month.
 */
function Activity({ detail }: { detail: PayeeDetail }) {
  const [month, setMonth] = useState<string | null>(null);
  const latest = detail.recent[0]?.date.slice(0, 7) ?? detail.monthly[detail.monthly.length - 1]?.month;
  if (!latest) return <Empty>No transactions yet.</Empty>;

  const spend = new Map(detail.monthly.map((m) => [m.month, m.amount]));
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(latest, i - 11)).map((m) => ({ month: m, amount: spend.get(m) ?? 0 }));
  const max = Math.max(...months.map((m) => m.amount), 1);
  const avg = months.reduce((s, m) => s + m.amount, 0) / months.length;
  const rows = month ? detail.recent.filter((t) => t.date.startsWith(month)) : detail.recent;
  const older = detail.count - detail.recent.length;

  return (
    <div className="flex flex-col gap-4">
      {avg > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Spending by month</div>
            <div className="text-[11px] text-text-muted">avg <span className="font-mono text-text-dim">{fmtP(avg)}</span>/mo</div>
          </div>
          <div className="flex gap-1 items-end h-20">
            {months.map((m) => {
              const on = month === m.month;
              return (
                <button
                  key={m.month}
                  type="button"
                  onClick={() => setMonth(on ? null : m.month)}
                  aria-pressed={on}
                  aria-label={`${moLabel(m.month)}: ${fmtP(m.amount)}`}
                  title={`${moLabel(m.month)} · ${fmtP(m.amount)}`}
                  className="flex-1 h-full flex flex-col justify-end items-center gap-1 min-w-0 group"
                >
                  <div
                    className={`w-full max-w-[28px] rounded-sm transition-colors ${
                      on ? "bg-accent" : month ? "bg-accent/25 group-hover:bg-accent/50" : "bg-accent/70 group-hover:bg-accent"
                    }`}
                    style={{ height: `${m.amount ? Math.max(3, (m.amount / max) * 56) : 1}px` }}
                  />
                  <span className={`text-[9px] ${on ? "text-accent" : "text-text-muted"}`}>{moLabel(m.month).slice(0, 3)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {month && (
        <div className="flex items-center justify-between text-xs text-text-dim -mb-1">
          <span>Showing {moLabel(month)}</span>
          <button className="text-accent hover:underline" onClick={() => setMonth(null)}>Show all months</button>
        </div>
      )}

      {rows.length ? <TxnRows rows={rows} byMonth /> : <Empty>Nothing in {moLabel(month!)}.</Empty>}

      {!month && older > 0 && (
        <p className="text-[11px] text-text-muted -mt-2">{older} older transaction{older === 1 ? "" : "s"} not shown.</p>
      )}
    </div>
  );
}
