import { useCallback, useEffect, useId, useState } from "react";
import { api } from "../../lib/api";
import { fmtDate, fmtP, today } from "../../lib/formatters";
import { ROLE_LABELS, parseNum } from "../../lib/investments";
import Modal from "../layout/Modal";
import MoneyInput from "../layout/MoneyInput";
import Confirm from "../layout/Confirm";
import type { Account, HoldingRole, Security, SnapshotRowInput } from "../../types";

export interface SnapshotStart {
  accountId: string | null;
  /** The snapshot date to edit; null starts a new one dated today */
  asOf: string | null;
  edit: boolean;
}

interface SnapshotModalProps {
  start: SnapshotStart | null;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, err?: boolean) => void;
  accounts: Account[];
  securities: Security[];
}

interface Line {
  key: string;
  symbol: string;
  shares: string;
  value: string;
  costBasis: string;
  role: "" | HoldingRole;
}

let lineSeq = 0;
const blank = (): Line => ({ key: `l${++lineSeq}`, symbol: "", shares: "", value: "", costBasis: "", role: "" });
const str = (n: number | null | undefined) => (n == null ? "" : String(n));

export default function SnapshotModal({ start, onClose, onSaved, onToast, accounts, securities }: SnapshotModalProps) {
  const open = !!start;
  const listId = useId();
  const [accountId, setAccountId] = useState("");
  const [asOf, setAsOf] = useState(today());
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  /** Fill the rows from the account's snapshot on editDate, or its latest one as a starting point */
  const load = useCallback(
    async (id: string, editDate: string | null) => {
      if (!id) {
        setLines([blank()]);
        setFrom(null);
        return;
      }
      setLoading(true);
      try {
        const snap = await api.holdings.snapshot(id, editDate ?? undefined);
        const rows = snap.rows.map((r) => ({
          key: `l${++lineSeq}`, symbol: r.symbol, shares: str(r.shares), value: str(r.value), costBasis: str(r.costBasis),
          role: (r.role ?? "") as Line["role"],
        }));
        setLines(rows.length ? rows : [blank()]);
        setFrom(editDate ? null : snap.asOf);
      } catch (err) {
        onToast(err instanceof Error ? err.message : "Failed to load the snapshot", true);
      } finally {
        setLoading(false);
      }
    },
    [onToast]
  );

  useEffect(() => {
    if (!start) return;
    setAccountId(start.accountId ?? "");
    setAsOf(start.edit && start.asOf ? start.asOf : today());
    setEditingDate(start.edit ? start.asOf : null);
    setConfirm(false);
    load(start.accountId ?? "", start.edit ? start.asOf : null);
  }, [start, load]);

  const account = accounts.find((a) => a.id === accountId);
  const bySymbol = new Map(securities.map((s) => [s.symbol, s]));
  const total = lines.reduce((s, l) => s + (parseNum(l.value) ?? 0), 0);

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function save() {
    if (!accountId) return onToast("Pick an account", true);
    const filled = lines.filter((l) => l.symbol.trim() || l.value.trim());
    if (!filled.length) return onToast("Add at least one holding", true);
    const rows: SnapshotRowInput[] = [];
    for (const l of filled) {
      const symbol = l.symbol.trim().toUpperCase();
      const value = parseNum(l.value);
      if (!symbol) return onToast("Every row needs a symbol", true);
      if (value == null) return onToast(`${symbol}: type its value`, true);
      rows.push({ symbol, shares: parseNum(l.shares), value, costBasis: parseNum(l.costBasis), role: l.role || null });
    }
    setSaving(true);
    try {
      const r = await api.holdings.saveSnapshot({ accountId, asOf, previousAsOf: editingDate ?? undefined, rows });
      onToast(
        `Saved ${r.saved} holding${r.saved === 1 ? "" : "s"}` +
          (r.created.length ? `. New on the list: ${r.created.join(", ")}. Fill in what they are.` : "")
      );
      onSaved();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to save", true);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editingDate) return;
    try {
      await api.holdings.deleteSnapshot(accountId, editingDate);
      onToast("Snapshot deleted");
      onSaved();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to delete", true);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        variant="form"
        className="md:w-[780px]"
        title={editingDate ? "Edit snapshot" : "New snapshot"}
        aside={editingDate && <button className="btn btn-danger btn-sm" onClick={() => setConfirm(true)}>🗑️ Delete</button>}
        footer={
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving || loading}>Save</button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[1fr_170px] max-md:grid-cols-1 gap-3">
            <div className="input-group">
              <label>Account</label>
              <select
                value={accountId}
                disabled={!!editingDate}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  load(e.target.value, null);
                }}
              >
                <option value="">Pick an account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {[a.institution, a.type].filter(Boolean).join(" ")}{a.owner ? ` (${a.owner})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <label>As of</label>
              <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </div>
          </div>

          <p className="text-[11px] text-text-muted -mt-1">
            Type what the broker shows on the date, usually the 1st. {from && <>Started from the {fmtDate(from)} snapshot; update each value. </>}
            A symbol that isn't on the list yet gets added to it.
          </p>

          <datalist id={listId}>
            {securities.map((s) => (
              <option key={s.id} value={s.symbol}>{s.name ?? ""}</option>
            ))}
          </datalist>

          {loading ? (
            <p className="text-xs text-text-muted py-3">Loading…</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-[1.1fr_1fr_1.2fr_1.2fr_1fr_32px] gap-2 text-[11px] text-text-muted max-md:hidden px-0.5">
                <span>Symbol</span><span>Shares</span><span>Value</span><span>Cost basis</span><span>Role</span><span />
              </div>
              {lines.map((l) => {
                const sec = bySymbol.get(l.symbol.trim().toUpperCase());
                return (
                  <div
                    key={l.key}
                    className="grid grid-cols-[1.1fr_1fr_1.2fr_1.2fr_1fr_32px] max-md:grid-cols-2 gap-2 items-center max-md:border-b max-md:border-border/50 max-md:pb-3"
                  >
                    <input
                      type="text"
                      list={listId}
                      placeholder="VTI"
                      autoCapitalize="characters"
                      aria-label="Symbol"
                      value={l.symbol}
                      onChange={(e) => setLine(l.key, { symbol: e.target.value.toUpperCase() })}
                      className="font-mono"
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Shares"
                      aria-label="Shares"
                      value={l.shares}
                      onChange={(e) => setLine(l.key, { shares: e.target.value })}
                      className="font-mono"
                    />
                    <MoneyInput aria-label="Value" placeholder="Value" value={l.value} onChange={(v) => setLine(l.key, { value: v })} />
                    <MoneyInput aria-label="Cost basis" placeholder="Cost basis" value={l.costBasis} onChange={(v) => setLine(l.key, { costBasis: v })} />
                    <select aria-label="Role" value={l.role} onChange={(e) => setLine(l.key, { role: e.target.value as Line["role"] })}>
                      <option value="">{sec ? `${ROLE_LABELS[sec.role]} (default)` : "Default"}</option>
                      <option value="core">Core</option>
                      <option value="play">Play money</option>
                    </select>
                    <button
                      className="text-text-muted hover:text-red text-lg leading-none"
                      title="Remove row"
                      aria-label="Remove row"
                      onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank()]))}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <button className="btn btn-sm self-start" onClick={() => setLines((ls) => [...ls, blank()])}>+ Add row</button>
            </div>
          )}

          <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-border/60 text-sm">
            <span className="text-text-dim">Total</span>
            <span className="font-mono font-semibold">{fmtP(total)}</span>
          </div>
          {account && (
            <p className="text-[11px] text-text-muted -mt-2">
              Assets page balance: {fmtP(account.balance)}{account.lastUpdated ? ` (updated ${fmtDate(account.lastUpdated)})` : ""}. Saving a
              snapshot doesn't change it.
            </p>
          )}
        </div>
      </Modal>
      <Confirm
        open={open && confirm}
        title="Delete this snapshot?"
        message={`Every holding saved for this account on ${fmtDate(editingDate)} goes away. The list of securities stays.`}
        onConfirm={remove}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
