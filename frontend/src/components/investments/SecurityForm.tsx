import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { CLASS_LABELS, KIND_LABELS, ROLE_LABELS, STATUS_LABELS, parseNum } from "../../lib/investments";
import Modal from "../layout/Modal";
import Confirm from "../layout/Confirm";
import Segmented from "../layout/Segmented";
import type { AssetClass, HoldingRole, Security, SecurityKind, SecurityStatus } from "../../types";

interface SecurityFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, err?: boolean) => void;
  security: Security | null;
}

interface Fields {
  symbol: string;
  name: string;
  kind: SecurityKind;
  assetClass: AssetClass;
  role: HoldingRole;
  status: SecurityStatus;
  expenseRatio: string;
  why: string;
  notes: string;
}

const EMPTY: Fields = {
  symbol: "", name: "", kind: "fund", assetClass: "us_stock", role: "core", status: "keep", expenseRatio: "", why: "", notes: "",
};

function fromSecurity(s: Security | null): Fields {
  if (!s) return EMPTY;
  return {
    symbol: s.symbol, name: s.name ?? "", kind: s.kind, assetClass: s.assetClass, role: s.role, status: s.status,
    expenseRatio: s.expenseRatio == null ? "" : String(s.expenseRatio), why: s.why ?? "", notes: s.notes ?? "",
  };
}

export default function SecurityForm({ open, onClose, onSaved, onToast, security }: SecurityFormProps) {
  const [f, setF] = useState<Fields>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    setF(fromSecurity(security));
    setConfirm(false);
  }, [security, open]);

  const set = <K extends keyof Fields>(k: K) => (v: Fields[K]) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!f.symbol.trim()) return onToast("Type a symbol", true);
    const payload: Partial<Security> = {
      symbol: f.symbol.trim().toUpperCase(),
      name: f.name.trim() || null,
      kind: f.kind,
      assetClass: f.assetClass,
      role: f.role,
      status: f.status,
      expenseRatio: parseNum(f.expenseRatio),
      why: f.why.trim() || null,
      notes: f.notes.trim() || null,
    };
    setSaving(true);
    try {
      if (security) await api.holdings.updateSecurity(security.id, payload);
      else await api.holdings.createSecurity(payload);
      onToast(security ? `${payload.symbol} updated` : `${payload.symbol} added`);
      onSaved();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to save", true);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!security) return;
    try {
      await api.holdings.deleteSecurity(security.id);
      onToast(`${security.symbol} removed from the list`);
      onSaved();
      onClose();
    } catch (err) {
      setConfirm(false);
      onToast(err instanceof Error ? err.message : "Failed to delete", true);
    }
  }

  const select = <K extends "kind" | "assetClass">(k: K, label: string, labels: Record<Fields[K], string>) => (
    <div className="input-group">
      <label>{label}</label>
      <select value={f[k]} onChange={(e) => set(k)(e.target.value as Fields[K])}>
        {(Object.keys(labels) as Fields[K][]).map((v) => (
          <option key={v} value={v}>{labels[v]}</option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        variant="form"
        title={security ? `Edit ${security.symbol}` : "Add to the list"}
        aside={security && <button className="btn btn-danger btn-sm" onClick={() => setConfirm(true)}>🗑️ Delete</button>}
        footer={
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{security ? "Update" : "Add"}</button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[140px_1fr] max-md:grid-cols-1 gap-3">
            <div className="input-group">
              <label>Symbol</label>
              <input
                type="text"
                placeholder="VTI"
                autoCapitalize="characters"
                value={f.symbol}
                onChange={(e) => set("symbol")(e.target.value.toUpperCase())}
              />
            </div>
            <div className="input-group">
              <label>Name</label>
              <input type="text" placeholder="Vanguard Total Stock Market ETF" value={f.name} onChange={(e) => set("name")(e.target.value)} />
            </div>
          </div>
          <div className="text-[11px] text-text-muted -mt-2">
            For a 401k fund with no ticker, make up a short code like 401K-SP500.
          </div>

          <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
            {select("kind", "Kind", KIND_LABELS)}
            {select("assetClass", "Counts as", CLASS_LABELS)}
          </div>

          <div className="input-group">
            <label>Role</label>
            <Segmented<HoldingRole>
              value={f.role}
              onChange={set("role")}
              full
              options={(["core", "play"] as const).map((v) => ({ value: v, label: ROLE_LABELS[v] }))}
            />
          </div>
          <div className="text-[11px] text-text-muted -mt-2">Play money counts against the play cap. A snapshot can still mark one holding differently (cash in a brokerage account, say).</div>

          <div className="input-group">
            <label>Decision</label>
            <Segmented<SecurityStatus>
              value={f.status}
              onChange={set("status")}
              full
              options={(["keep", "watch", "remove"] as const).map((v) => ({ value: v, label: STATUS_LABELS[v] }))}
            />
          </div>

          <div className="input-group">
            <label>Expense ratio (% a year)</label>
            <input type="text" inputMode="decimal" placeholder="0.03" value={f.expenseRatio} onChange={(e) => set("expenseRatio")(e.target.value)} />
          </div>

          <div className="input-group">
            <label>Why we own it</label>
            <input type="text" placeholder="One line: the reason, or the pitch" value={f.why} onChange={(e) => set("why")(e.target.value)} />
          </div>

          <div className="input-group">
            <label>Notes</label>
            <textarea rows={2} value={f.notes} onChange={(e) => set("notes")(e.target.value)} />
          </div>
        </div>
      </Modal>
      <Confirm
        open={open && confirm}
        title={`Delete ${security?.symbol}?`}
        message="Only possible while no snapshot uses it. To stop holding it, mark it Remove instead so the history stays."
        onConfirm={remove}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
