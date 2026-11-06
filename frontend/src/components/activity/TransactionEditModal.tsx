import { useEffect, useState } from "react";
import Modal from "../layout/Modal";
import { api } from "../../lib/api";
import { fmtDate, fmtP } from "../../lib/formatters";
import AliasEditor, { type AliasDraft } from "./AliasEditor";
import { KIND_LABELS, defaultPattern } from "./shared";
import type { Payee, Transaction, TxnKind } from "../../types";

interface Props {
  txn: Transaction | null;
  payees: Payee[];
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, err?: boolean) => void;
}

/**
 * Put a transaction under a payee. With "Remember" on, the statement text becomes an
 * alias of the payee (past and future imports) and category/type become the payee's defaults.
 * With it off, only this one transaction changes.
 */
export default function TransactionEditModal({ txn, payees, categories, onClose, onSaved, onToast }: Props) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState<TxnKind>("spend");
  const [remember, setRemember] = useState(true);
  const [alias, setAlias] = useState<AliasDraft>({ pattern: "", match: "contains", amount: null });
  const [saving, setSaving] = useState(false);

  const currentPayee = txn?.payeeId ? payees.find((p) => p.id === txn.payeeId) : undefined;

  useEffect(() => {
    if (!txn) return;
    setName(currentPayee?.name ?? txn.merchant);
    setCategory(txn.category);
    setKind(txn.kind);
    setRemember(true);
    setAlias({ pattern: defaultPattern(txn.description), match: "contains", amount: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txn]);

  if (!txn) return null;
  const t = txn;

  async function save() {
    setSaving(true);
    try {
      const payeeName = name.trim();
      const changedCategory = category.trim() && category.trim() !== t.category ? category.trim() : undefined;
      const changedKind = kind !== t.kind ? kind : undefined;
      if (remember) {
        if (!payeeName) throw new Error("Give the payee a name");
        await api.transactions.update(t.id, {
          payeeName,
          category: category.trim() && category.trim() !== "Uncategorized" ? category.trim() : undefined,
          kind: changedKind,
          remember: { pattern: alias.pattern.trim(), match: alias.match, amount: alias.amount },
        });
        onToast(`Saved · “${alias.pattern.trim()}” now means ${payeeName}`);
      } else {
        const renamed = payeeName !== (currentPayee?.name ?? t.merchant);
        await api.transactions.update(t.id, {
          ...(renamed ? (payeeName ? { payeeName } : { payeeId: null }) : {}),
          category: changedCategory,
          kind: changedKind,
        });
        onToast("Transaction updated");
      }
      onSaved();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to save", true);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      await api.transactions.update(t.id, { reset: true });
      onToast("Back to automatic");
      onSaved();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to reset", true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!txn} onClose={onClose} title="Edit transaction">
      <div className="text-xs text-text-muted mb-4 leading-relaxed">
        <div className="font-mono text-text-dim break-all">{t.description}</div>
        {fmtDate(t.date)} · <span className="font-mono">{fmtP(t.amount)}</span>
        {currentPayee
          ? <> · payee <span className="text-text-dim">{currentPayee.name}</span>{t.payeeLocked ? " (picked by hand)" : ""}</>
          : <> · no payee yet</>}
      </div>

      <div className="flex flex-col gap-4">
        <div className="input-group">
          <label>Payee</label>
          <input list="payee-names" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.baseMerchant ?? ""} />
          <datalist id="payee-names">
            {payees.map((p) => <option key={p.id} value={p.name} />)}
          </datalist>
          <span className="text-[11px] text-text-muted">
            {payees.some((p) => p.name.toLowerCase() === name.trim().toLowerCase())
              ? "Existing payee"
              : name.trim() ? "A new payee will be created" : ""}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="input-group">
            <label>Category</label>
            <input list="txn-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="txn-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="input-group">
            <label>Type</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as TxnKind)}>
              {(Object.keys(KIND_LABELS) as TxnKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </div>
        </div>

        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5" />
          <span>
            Remember: statement text that means this payee
            <span className="block text-[11px] text-text-muted">
              {remember
                ? "Applies to past and future imports. The category and type become this payee's defaults."
                : "Only this transaction changes."}
            </span>
          </span>
        </label>
        {remember && <AliasEditor value={alias} onChange={setAlias} amountHint={t.amount} />}

        <div className="flex items-center gap-2 mt-2">
          {(t.edited === 1 || t.payeeLocked === 1) && (
            <button className="btn btn-sm" disabled={saving} onClick={reset} title="Drop hand edits on this transaction">
              Reset to automatic
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={saving || (remember && (alias.pattern.trim().length < 3 || !name.trim()))}
              onClick={save}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
