import { useEffect, useState } from "react";
import Modal from "../layout/Modal";
import Picker from "../layout/Picker";
import Segmented from "../layout/Segmented";
import { api } from "../../lib/api";
import { fmtDate, fmtP } from "../../lib/formatters";
import { money } from "./shared";
import type { Payee } from "../../types";

export interface MergeMember {
  /** "p:<payeeId>", "m:<bank name key>", or "t:<transactionId>" for one transaction */
  key: string;
  name: string;
  count?: number;
  spent?: number;
  received?: number;
  /** One transaction's date and signed amount */
  date?: string;
  amount?: number;
}

/** Names listed before "Show all" */
const MEMBER_ROWS = 6;

interface Props {
  members: MergeMember[] | null;
  payees: Payee[];
  suggestedName?: string;
  categories: string[];
  onClose: () => void;
  onDone: (payeeId: string) => void;
  onToast: (msg: string, err?: boolean) => void;
}

/**
 * Put bank names (and/or payees) under one payee: a new one or an existing one.
 * With only "t:" members, assigns just those transactions by hand instead: each is
 * locked to the payee, and other rows with the same bank name stay where they are.
 */
export default function MergeModal({ members, payees, suggestedName, categories, onClose, onDone, onToast }: Props) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [targetId, setTargetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [allMembers, setAllMembers] = useState(false);

  useEffect(() => {
    if (!members) return;
    const existing = members.find((m) => m.key.startsWith("p:"));
    setMode(existing ? "existing" : "new");
    setTargetId(existing ? existing.key.slice(2) : payees[0]?.id ?? "");
    setName(suggestedName ?? members[0]?.name ?? "");
    setCategory("");
    setAllMembers(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  if (!members) return null;
  const txnIds = members.every((m) => m.key.startsWith("t:")) ? members.map((m) => m.key.slice(2)) : null;

  /** One PUT per transaction, the same hand assignment as the transaction editor */
  async function assignTransactions(ids: string[]) {
    let payeeId = targetId;
    let payeeName = payees.find((p) => p.id === targetId)?.name ?? "";
    if (mode === "new") {
      const created = await api.payees.create({ name: name.trim(), category: category.trim() || undefined });
      payeeId = created.id;
      payeeName = created.name;
    }
    let moved = 0;
    try {
      for (const id of ids) {
        await api.transactions.update(id, { payeeId });
        moved++;
      }
    } catch (err) {
      // Some may have moved already: refresh the lists so they show it
      if (moved) onDone(payeeId);
      throw new Error(`${moved ? `Moved ${moved} of ${ids.length}. ` : ""}${err instanceof Error ? err.message : "Failed"}`);
    }
    onToast(`${ids.length} transaction${ids.length === 1 ? "" : "s"} now under ${payeeName}`);
    onDone(payeeId);
    onClose();
  }

  async function save() {
    setSaving(true);
    try {
      if (txnIds) return await assignTransactions(txnIds);
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
      variant="form"
      title={
        txnIds ? `Assign ${txnIds.length} Transaction${txnIds.length === 1 ? "" : "s"}`
        : members.length === 1 ? "Name This Payee" : `Group ${members.length} Names`
      }
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
      {/* Not a scroll box: one that scrolls inside the scrolling sheet is hard to use by touch */}
      <div className="flex flex-col gap-1 mb-4">
        {(allMembers ? members : members.slice(0, MEMBER_ROWS)).map((m) => (
          <div key={m.key} className="flex justify-between gap-3 text-xs py-1 border-b border-border/30 last:border-0">
            {/* Wraps on phones, where there's no hover to read a cut-off name */}
            <span className={`truncate max-md:whitespace-normal max-md:break-all min-w-0 ${txnIds ? "font-mono" : ""}`} title={m.name}>
              {m.name}
              {m.key.startsWith("p:") && <span className="text-accent"> · payee</span>}
            </span>
            {m.amount != null && (
              <span className="text-text-muted shrink-0 tabular-nums">
                {m.date && <>{fmtDate(m.date)} · </>}
                <span className={`font-mono ${m.amount > 0 ? "text-green" : ""}`}>{m.amount > 0 ? "+" : ""}{fmtP(m.amount)}</span>
              </span>
            )}
            {m.count != null && (
              <span className="text-text-muted shrink-0">{m.count}× · <span className="font-mono">{money(m.spent ?? 0, m.received ?? 0, fmtP)}</span></span>
            )}
          </div>
        ))}
      </div>

      {members.length > MEMBER_ROWS && (
        <button type="button" className="link-tap text-xs -mt-2 mb-3" onClick={() => setAllMembers((v) => !v)}>
          {allMembers ? "Show fewer" : `Show all ${members.length}`}
        </button>
      )}

      <Segmented
        className="mb-4"
        value={mode}
        onChange={setMode}
        options={[
          { value: "new", label: "New payee" },
          { value: "existing", label: "Existing payee", disabled: payees.length === 0 },
        ]}
      />

      {mode === "new" ? (
        <div className="flex flex-col gap-3">
          <div className="input-group">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoCorrect="off" autoCapitalize="words" enterKeyHint="next" />
          </div>
          <div className="input-group">
            <label>Category (optional)</label>
            <Picker
              title="Category"
              value={category}
              onChange={setCategory}
              options={categories}
              placeholder="Keep what the bank says"
              clearLabel="Keep what the bank says"
            />
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
        {txnIds
          ? "Only these transactions move, picked by hand. Other transactions with the same bank name keep no payee, and no alias is added."
          : "Each bank name becomes an alias, so future imports land here too. Payees in the list are folded into this one."}
      </p>

    </Modal>
  );
}
