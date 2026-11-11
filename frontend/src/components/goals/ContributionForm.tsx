import { useState, useEffect } from "react";
import Modal from "../layout/Modal";
import MoneyInput from "../layout/MoneyInput";
import Segmented from "../layout/Segmented";
import { api } from "../../lib/api";
import { fmtP, today } from "../../lib/formatters";
import type { Goal } from "../../types";

interface ContributionFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: (goal: Goal) => void;
  onToast: (msg: string, err?: boolean) => void;
  goal: Goal | null;
}

export default function ContributionForm({ open, onClose, onSaved, onToast, goal }: ContributionFormProps) {
  const [mode, setMode] = useState<"add" | "withdraw">("add");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMode("add");
    setAmount("");
    setDate(today());
    setNote("");
  }, [goal, open]);

  if (!goal) return null;

  const value = parseFloat(amount) || 0;
  const delta = mode === "add" ? value : -value;
  const after = Math.max(0, goal.savedAmount + delta);
  const pctAfter = goal.targetAmount > 0 ? Math.min(100, (after / goal.targetAmount) * 100) : 0;

  async function handleSave() {
    if (!goal) return;
    if (value <= 0) return onToast("Enter an amount", true);
    if (mode === "withdraw" && value > goal.savedAmount) {
      return onToast(`Only ${fmtP(goal.savedAmount)} saved`, true);
    }
    setSaving(true);
    try {
      const updated = await api.goals.contribute(goal.id, {
        amount: delta,
        date,
        note: note.trim() || undefined,
      });
      const reached = !goal.completedAt && updated.completedAt;
      onToast(reached ? `🎉 ${goal.name} reached!` : mode === "add" ? "Contribution logged" : "Withdrawal logged");
      onSaved(updated);
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to save", true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="form"
      title={goal.name}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {mode === "add" ? "Add" : "Withdraw"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          full
          value={mode}
          onChange={setMode}
          options={[
            { value: "add", label: "Add money", activeClass: "bg-green-dim text-green" },
            { value: "withdraw", label: "Withdraw", activeClass: "bg-red-dim text-red" },
          ]}
        />

        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <div className="input-group">
            <label>Amount</label>
            <MoneyInput
              value={amount}
              onChange={setAmount}
              enterKeyHint="go"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <div className="input-group">
            <label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div className="input-group">
          <label>Note (optional)</label>
          <input
            type="text"
            placeholder="e.g. Bonus, tax refund"
            autoCapitalize="sentences"
            enterKeyHint="done"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="bg-bg-input border border-border rounded-lg px-4 py-3 text-xs text-text-muted">
          <div className="flex justify-between mb-2">
            <span>After this</span>
            <span>
              <span className="font-mono text-text">{fmtP(after)}</span>{goal.targetAmount > 0 ? <> of {fmtP(goal.targetAmount)}</> : " saved"}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pctAfter >= 100 ? "bg-green" : "bg-accent"}`}
              style={{ width: `${pctAfter}%` }}
            />
          </div>
          <div className="text-right mt-1.5 font-mono">{pctAfter.toFixed(0)}%</div>
        </div>
      </div>
    </Modal>
  );
}
