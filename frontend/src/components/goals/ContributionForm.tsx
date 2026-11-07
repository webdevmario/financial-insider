import { useState, useEffect } from "react";
import Modal from "../layout/Modal";
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
        <div className="grid grid-cols-2 gap-1 p-1 bg-bg-input border border-border rounded-lg">
          {(["add", "withdraw"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`py-1.5 rounded-md text-[13px] font-medium transition-all ${
                mode === m
                  ? m === "add"
                    ? "bg-green-dim text-green"
                    : "bg-red-dim text-red"
                  : "text-text-dim hover:text-text"
              }`}
            >
              {m === "add" ? "Add money" : "Withdraw"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <div className="input-group">
            <label>Amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
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
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="bg-bg-input border border-border rounded-lg px-4 py-3 text-xs text-text-muted">
          <div className="flex justify-between mb-2">
            <span>After this</span>
            <span>
              <span className="font-mono text-text">{fmtP(after)}</span> of {fmtP(goal.targetAmount)}
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
