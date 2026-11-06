import { useCallback, useEffect, useState } from "react";
import Modal from "../layout/Modal";
import { api } from "../../lib/api";
import { fmt, fmtDate, fmtP, moLabel } from "../../lib/formatters";
import AliasEditor, { type AliasDraft } from "./AliasEditor";
import { Badge, KIND_LABELS, MATCH_LABELS } from "./shared";
import type { PayeeDetail, Subscription, TxnKind } from "../../types";

interface Props {
  payeeId: string | null;
  categories: string[];
  onClose: () => void;
  onChanged: () => void;
  onToast: (msg: string, err?: boolean) => void;
}

export default function PayeeModal({ payeeId, categories, onClose, onChanged, onToast }: Props) {
  const [detail, setDetail] = useState<PayeeDetail | null>(null);
  const [bills, setBills] = useState<Subscription[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState("");
  const [billId, setBillId] = useState("");
  const [draft, setDraft] = useState<AliasDraft>({ pattern: "", match: "contains", amount: null });
  const [busy, setBusy] = useState(false);

  const fill = useCallback((d: PayeeDetail) => {
    setDetail(d);
    setName(d.name);
    setCategory(d.category ?? "");
    setKind(d.kind ?? "");
    setBillId(d.billId ?? "");
  }, []);

  useEffect(() => {
    if (!payeeId) return;
    setDetail(null);
    setDraft({ pattern: "", match: "contains", amount: null });
    api.payees.get(payeeId).then(fill).catch(() => onToast("Couldn't load payee", true));
    api.subscriptions.list().then(setBills).catch(() => setBills([]));
  }, [payeeId, fill, onToast]);

  if (!payeeId) return null;

  async function run(fn: () => Promise<PayeeDetail | void>, msg: string) {
    setBusy(true);
    try {
      const d = await fn();
      if (d) fill(d);
      onToast(msg);
      onChanged();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed", true);
    } finally {
      setBusy(false);
    }
  }

  const dirty =
    detail && (name.trim() !== detail.name || (category.trim() || null) !== detail.category || (kind || null) !== detail.kind || (billId || null) !== detail.billId);
  const max = Math.max(...(detail?.monthly.map((m) => m.amount) ?? [1]), 1);

  return (
    <Modal open={!!payeeId} onClose={onClose} title={detail?.name ?? "Payee"}>
      {!detail ? (
        <div className="text-sm text-text-muted py-6 text-center">Loading…</div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="text-xs text-text-muted">
            {detail.count} transactions · {fmt(detail.spent)} spent{detail.lastDate && <> · last {fmtDate(detail.lastDate)}</>}
            {detail.handPicked > 0 && <> · {detail.handPicked} picked by hand</>}
          </div>

          <div className="flex flex-col gap-3">
            <div className="input-group">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="input-group">
                <label>Category</label>
                <input list="payee-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="What the bank says" />
                <datalist id="payee-categories">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="input-group">
                <label>Type</label>
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="">Automatic</option>
                  {(Object.keys(KIND_LABELS) as TxnKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                </select>
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
            {dirty && (
              <button
                className="btn btn-primary btn-sm self-end"
                disabled={busy || !name.trim()}
                onClick={() =>
                  run(
                    () => api.payees.update(detail.id, { name: name.trim(), category: category.trim() || null, kind: kind || null, billId: billId || null }),
                    "Payee saved"
                  )
                }
              >
                Save changes
              </button>
            )}
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">Aliases</div>
            {detail.aliases.length === 0 ? (
              <div className="text-xs text-text-muted mb-2">None. Transactions were picked by hand.</div>
            ) : (
              <div className="flex flex-col mb-3">
                {detail.aliases.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-border/30 last:border-0">
                    <Badge className="bg-white/[0.06] text-text-dim">{MATCH_LABELS[a.match]}</Badge>
                    <span className="font-mono truncate flex-1">{a.pattern}</span>
                    {a.amount != null && <span className="font-mono text-text-muted">= {fmtP(a.amount)}</span>}
                    <span className={`text-text-muted shrink-0 ${a.matched === 0 ? "text-amber" : ""}`}>{a.matched}×</span>
                    <button
                      className="text-text-muted hover:text-red px-1"
                      title="Remove alias"
                      disabled={busy}
                      onClick={() => run(() => api.payees.deleteAlias(detail.id, a.id), "Alias removed")}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <AliasEditor value={draft} onChange={setDraft} />
            <button
              className="btn btn-sm mt-2"
              disabled={busy || draft.pattern.trim().length < 3}
              onClick={() =>
                run(async () => {
                  const d = await api.payees.addAlias(detail.id, draft);
                  setDraft({ pattern: "", match: "contains", amount: null });
                  return d;
                }, "Alias added")
              }
            >
              + Add alias
            </button>
          </div>

          {detail.bankNames.length > 1 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">Seen on statements as</div>
              <div className="text-xs text-text-dim">{detail.bankNames.join(" · ")}</div>
            </div>
          )}

          {detail.monthly.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">Spending by month</div>
              <div className="flex gap-1 items-end h-20">
                {detail.monthly.slice(-12).map((m) => (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${moLabel(m.month)} · ${fmtP(m.amount)}`}>
                    <div className="w-full max-w-[28px] rounded-sm bg-accent/70" style={{ height: `${Math.max(3, (m.amount / max) * 56)}px` }} />
                    <span className="text-[9px] text-text-muted">{moLabel(m.month).slice(0, 3)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {detail.recent.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">Recent</div>
              {detail.recent.slice(0, 8).map((t) => (
                <div key={t.id} className="flex justify-between gap-3 text-xs py-1 border-b border-border/30 last:border-0">
                  <span className="truncate"><span className="text-text-muted">{fmtDate(t.date)} ·</span> <span className="font-mono">{t.description}</span></span>
                  <span className="font-mono shrink-0">{fmtP(t.amount)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between pt-2 border-t border-border">
            <button
              className="btn btn-sm btn-danger"
              disabled={busy}
              onClick={() => {
                if (!confirm(`Delete “${detail.name}”? Its transactions go back to their bank names.`)) return;
                run(async () => {
                  await api.payees.delete(detail.id);
                  onClose();
                }, "Payee deleted");
              }}
            >
              Delete payee
            </button>
            <button className="btn btn-sm" onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
