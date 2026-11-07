import { useEffect, useState } from "react";
import Modal from "../layout/Modal";
import { api } from "../../lib/api";
import { fmtP } from "../../lib/formatters";
import type { Payee } from "../../types";

export interface MergeMember {
  /** "p:<payeeId>" or "m:<bank name key>" */
  key: string;
  name: string;
  count?: number;
  spent?: number;
}

interface Props {
  members: MergeMember[] | null;
  payees: Payee[];
  suggestedName?: string;
  categories: string[];
  onClose: () => void;
  onDone: (payeeId: string) => void;
  onToast: (msg: string, err?: boolean) => void;
}

/** Put bank names (and/or payees) under one payee: a new one or an existing one */
export default function MergeModal({ members, payees, suggestedName, categories, onClose, onDone, onToast }: Props) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [targetId, setTargetId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!members) return;
    const existing = members.find((m) => m.key.startsWith("p:"));
    setMode(existing ? "existing" : "new");
    setTargetId(existing ? existing.key.slice(2) : payees[0]?.id ?? "");
    setName(suggestedName ?? members[0]?.name ?? "");
    setCategory("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  if (!members) return null;

  async function save() {
    setSaving(true);
    try {
      const result = await api.payees.merge(
        mode === "existing"
          ? { payeeId: targetId, members: members!.map((m) => m.key) }
          : { name: name.trim(), category: category.trim() || undefined, members: members!.map((m) => m.key) }
      );
      onToast(`${members!.length} name${members!.length === 1 ? "" : "s"} now grouped as ${result.name}`);
      onDone(result.id);
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Merge failed", true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!members}
      onClose={onClose}
      title={members.length === 1 ? "Name This Payee" : `Group ${members.length} Names`}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={saving || (mode === "new" ? !name.trim() : !targetId)}
            onClick={save}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-1 mb-4 max-h-[180px] scroll-list">
        {members.map((m) => (
          <div key={m.key} className="flex justify-between gap-3 text-xs py-1 border-b border-border/30 last:border-0">
            <span className="truncate">
              {m.name}
              {m.key.startsWith("p:") && <span className="text-accent"> · payee</span>}
            </span>
            {m.count != null && (
              <span className="text-text-muted shrink-0">{m.count}× · <span className="font-mono">{fmtP(m.spent ?? 0)}</span></span>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-0.5 p-0.5 bg-bg border border-border rounded-lg mb-4 w-fit">
        {(["new", "existing"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            disabled={m === "existing" && payees.length === 0}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all disabled:opacity-40 ${
              mode === m ? "text-accent bg-accent/[0.1]" : "text-text-dim hover:text-text"
            }`}
          >
            {m === "new" ? "New payee" : "Existing payee"}
          </button>
        ))}
      </div>

      {mode === "new" ? (
        <div className="flex flex-col gap-3">
          <div className="input-group">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Category (optional)</label>
            <input list="merge-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Keep what the bank says" />
            <datalist id="merge-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
        </div>
      ) : (
        <div className="input-group">
          <label>Payee</label>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {payees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      <p className="text-[11px] text-text-muted mt-3">
        Each bank name becomes an alias, so future imports land here too. Payees in the list are folded into this one.
      </p>

    </Modal>
  );
}
