import { useEffect, useState } from "react";
import Modal from "../layout/Modal";
import { api } from "../../lib/api";
import { fmtDate, fmtP } from "../../lib/formatters";
import { KIND_LABELS } from "./shared";
import type { Transaction, TxnKind } from "../../types";

interface Props {
  txn: Transaction | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, err?: boolean) => void;
}

/** Edit one transaction, or teach a rule that applies to every matching one */
export default function TransactionEditModal({ txn, categories, onClose, onSaved, onToast }: Props) {
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState<TxnKind>("spend");
  const [asRule, setAsRule] = useState(true);
  const [pattern, setPattern] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!txn) return;
    setMerchant(txn.merchant);
    setCategory(txn.category);
    setKind(txn.kind);
    setAsRule(true);
    // Default pattern: the start of the bank's description, before any numbers
    setPattern(txn.description.replace(/\s+/g, " ").split(/ #| \d{3,}|\*/)[0].trim().slice(0, 40));
  }, [txn]);

  if (!txn) return null;

  async function save() {
    if (!txn) return;
    setSaving(true);
    try {
      const changes = {
        merchant: merchant.trim() !== txn.merchant ? merchant.trim() : undefined,
        category: category.trim() !== txn.category ? category.trim() : undefined,
        kind: kind !== txn.kind ? kind : undefined,
      };
      if (!changes.merchant && !changes.category && !changes.kind) return onClose();
      if (asRule) {
        const r = await api.transactions.addRule({ pattern: pattern.trim(), ...changes });
        // The rule may not match this row if the pattern was edited: update it directly too
        await api.transactions.update(txn.id, changes);
        onToast(`Rule saved · ${r.updated} transaction${r.updated === 1 ? "" : "s"} updated`);
      } else {
        await api.transactions.update(txn.id, changes);
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

  return (
    <Modal open={!!txn} onClose={onClose} title="Edit transaction">
      <div className="text-xs text-text-muted mb-4 leading-relaxed">
        <div className="font-mono text-text-dim break-all">{txn.description}</div>
        {fmtDate(txn.date)} · <span className="font-mono">{fmtP(txn.amount)}</span>
      </div>

      <div className="flex flex-col gap-4">
        <div className="input-group">
          <label>Merchant</label>
          <input value={merchant} onChange={(e) => setMerchant(e.target.value)} />
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
          <input type="checkbox" checked={asRule} onChange={(e) => setAsRule(e.target.checked)} className="mt-0.5" />
          <span>
            Apply to every transaction containing
            <span className="block text-[11px] text-text-muted">Past and future imports. Matching ignores upper/lower case.</span>
          </span>
        </label>
        {asRule && <input value={pattern} onChange={(e) => setPattern(e.target.value)} className="font-mono !text-sm" />}

        <div className="flex justify-end gap-2 mt-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving || (asRule && pattern.trim().length < 3)} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
