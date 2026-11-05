import { useState, useEffect } from "react";
import Modal from "../layout/Modal";
import { api } from "../../lib/api";
import { fmtP, fmtDate } from "../../lib/formatters";
import { PRIORITY_LABELS } from "../../lib/goals";
import type { Goal, GoalPriority } from "../../types";

interface GoalFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, err?: boolean) => void;
  goal?: Goal | null;
}

export default function GoalForm({ open, onClose, onSaved, onToast, goal }: GoalFormProps) {
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [savedAmount, setSavedAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<GoalPriority>("medium");
  const [notes, setNotes] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(goal?.name || "");
    setTargetAmount(goal ? String(goal.targetAmount || "") : "");
    setSavedAmount(goal ? String(goal.savedAmount || "") : "");
    setDeadline(goal?.deadline || "");
    setPriority(goal?.priority || "medium");
    setNotes(goal?.notes || "");
    setShowConfirm(false);
  }, [goal, open]);

  const target = parseFloat(targetAmount) || 0;
  const saved = parseFloat(savedAmount) || 0;
  const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 0;

  async function handleSave() {
    if (!name.trim()) return onToast("Enter a goal name", true);
    if (target <= 0) return onToast("Enter a target amount", true);

    const payload = {
      name: name.trim(),
      targetAmount: target,
      savedAmount: saved,
      deadline: deadline || null,
      priority,
      notes: notes || null,
    };

    setSaving(true);
    try {
      if (goal) {
        await api.goals.update(goal.id, payload);
        onToast("Goal updated");
      } else {
        await api.goals.create(payload);
        onToast("Goal added");
      }
      onSaved();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to save", true);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!goal) return;
    try {
      await api.goals.delete(goal.id);
      onToast("Goal deleted");
      onSaved();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to delete", true);
    }
  }

  if (showConfirm) {
    return (
      <Modal open={open} onClose={() => setShowConfirm(false)} title={`Delete "${goal?.name}"?`}>
        <p className="text-sm text-text-dim mb-6">
          This removes the goal and its contribution history. It doesn't touch any of your accounts.
        </p>
        <div className="flex justify-end gap-2.5 pt-4 border-t border-border">
          <button className="btn" onClick={() => setShowConfirm(false)}>Cancel</button>
          <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
        </div>
      </Modal>
    );
  }

  const history = goal ? [...goal.history].reverse() : [];

  return (
    <Modal open={open} onClose={onClose} title={goal ? "Edit Goal" : "Add Goal"}>
      <div className="flex flex-col gap-4">
        <div className="input-group">
          <label>Goal Name</label>
          <input
            type="text"
            placeholder="e.g. Emergency fund, Kitchen remodel, Japan trip"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <div className="input-group">
            <label>Target Amount</label>
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label>{goal ? "Saved So Far" : "Already Saved"}</label>
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={savedAmount}
              onChange={(e) => setSavedAmount(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <div className="input-group">
            <label>Deadline (optional)</label>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as GoalPriority)}>
              {(["high", "medium", "low"] as const).map((p) => (
                <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </div>
        </div>

        {target > 0 && (
          <div className="text-xs text-text-muted -mt-1">
            <span className="font-mono text-text">{pct.toFixed(0)}%</span> of {fmtP(target)} ·{" "}
            {fmtP(Math.max(0, target - saved))} to go
          </div>
        )}

        <div className="input-group">
          <label>Notes (optional)</label>
          <textarea
            rows={2}
            placeholder="e.g. Keeping this in the Ally savings account"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {history.length > 0 && (
          <div className="input-group">
            <label>History</label>
            <div className="bg-bg-input border border-border rounded-lg max-h-[180px] overflow-y-auto">
              {history.map((h, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 px-3.5 py-2 text-xs border-b border-border/40 last:border-0"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-text-muted shrink-0">{fmtDate(h.date)}</span>
                    {h.note && <span className="text-text-dim truncate">{h.note}</span>}
                  </span>
                  <span className={`font-mono shrink-0 ${h.amount < 0 ? "text-red" : "text-green"}`}>
                    {h.amount < 0 ? "−" : "+"}
                    {fmtP(Math.abs(h.amount))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2.5 pt-4 border-t border-border max-md:pb-[env(safe-area-inset-bottom)]">
          {goal && (
            <button className="btn btn-danger btn-sm mr-auto" onClick={() => setShowConfirm(true)}>
              🗑️ Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {goal ? "Update" : "Add"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
