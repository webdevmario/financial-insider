import { useState, useEffect } from "react";
import Modal from "../layout/Modal";
import Confirm from "../layout/Confirm";
import MoneyInput from "../layout/MoneyInput";
import { api } from "../../lib/api";
import { fmtP, fmtDate } from "../../lib/formatters";
import { PRIORITY_LABELS } from "../../lib/goals";
import type { Goal, GoalPriority } from "../../types";

/** Contributions listed before "Show all" */
const HISTORY_ROWS = 5;

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
  const [allHistory, setAllHistory] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(goal?.name || "");
    setTargetAmount(goal ? String(goal.targetAmount || "") : "");
    setSavedAmount(goal ? String(goal.savedAmount || "") : "");
    setDeadline(goal?.deadline || "");
    setPriority(goal?.priority || "medium");
    setNotes(goal?.notes || "");
    setShowConfirm(false);
    setAllHistory(false);
  }, [goal, open]);

  const target = parseFloat(targetAmount) || 0;
  const saved = parseFloat(savedAmount) || 0;
  const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 0;

  async function handleSave() {
    if (!name.trim()) return onToast("Enter a goal name", true);

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

  const history = goal ? [...goal.history].reverse() : [];

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        variant="form"
        title={goal ? "Edit Goal" : "Add Goal"}
        aside={
          goal && (
            <button className="btn btn-danger btn-sm" onClick={() => setShowConfirm(true)}>
              🗑️ Delete
            </button>
          )
        }
        footer={
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {goal ? "Update" : "Add"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="input-group">
            <label>Goal Name</label>
            <input
              type="text"
              placeholder="e.g. Emergency fund, Kitchen remodel, Japan trip"
              autoCapitalize="sentences"
              enterKeyHint="next"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
            <div className="input-group">
              <label>Target Amount (optional)</label>
              <MoneyInput placeholder="Not set yet" value={targetAmount} onChange={setTargetAmount} />
            </div>
            <div className="input-group">
              <label>{goal ? "Saved So Far" : "Already Saved"}</label>
              <MoneyInput value={savedAmount} onChange={setSavedAmount} />
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
              {/* No scroll box of its own: a box that scrolls inside a scrolling sheet is hard to use by touch */}
              <div className="bg-bg-input border border-border rounded-lg">
                {(allHistory ? history : history.slice(0, HISTORY_ROWS)).map((h, i) => (
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
              {history.length > HISTORY_ROWS && (
                <button type="button" className="link-tap text-xs self-start" onClick={() => setAllHistory((v) => !v)}>
                  {allHistory ? "Show fewer" : `Show all ${history.length}`}
                </button>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Confirm
        open={open && showConfirm}
        title={`Delete "${goal?.name}"?`}
        message="This removes the goal and its contribution history. It doesn't touch any of your accounts."
        onConfirm={handleDelete}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
}
