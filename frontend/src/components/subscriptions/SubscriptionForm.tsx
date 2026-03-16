import { useState, useEffect } from "react";
import Modal from "../layout/Modal";
import { api } from "../../lib/api";
import { fmtP } from "../../lib/formatters";
import type { Subscription } from "../../types";
import { SUB_CATEGORIES } from "../../types";

/**
 * Given a stored nextCharge date and frequency, advance forward until >= today.
 */
function computeEffectiveNextCharge(
  nextCharge: string | null,
  frequency: "monthly" | "quarterly" | "annual"
): string | null {
  if (!nextCharge) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [y, m, d] = nextCharge.split("-").map(Number);
  const charge = new Date(y, m - 1, d);
  charge.setHours(0, 0, 0, 0);

  if (charge >= today) return nextCharge; // not stale

  const increment = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
  while (charge < today) {
    charge.setMonth(charge.getMonth() + increment);
  }

  const ny = charge.getFullYear();
  const nm = String(charge.getMonth() + 1).padStart(2, "0");
  const nd = String(charge.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

interface SubscriptionFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, err?: boolean) => void;
  subscription?: Subscription | null;
}

export default function SubscriptionForm({
  open, onClose, onSaved, onToast, subscription,
}: SubscriptionFormProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Other");
  const [frequency, setFrequency] = useState<"monthly" | "quarterly" | "annual">("monthly");
  const [amount, setAmount] = useState("");
  const [nextCharge, setNextCharge] = useState("");
  const [splitBy, setSplitBy] = useState(1);
  const [status, setStatus] = useState("");
  const [notes, setNotes] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (subscription) {
      setName(subscription.name);
      setCategory(subscription.category);
      setFrequency(subscription.frequency);
      setAmount(String(subscription.amount || ""));
      setNextCharge(
        computeEffectiveNextCharge(subscription.nextCharge, subscription.frequency) ||
        subscription.nextCharge || ""
      );
      setSplitBy(subscription.splitBy || 1);
      setStatus(subscription.status || "");
      setNotes(subscription.notes || "");
    } else {
      setName("");
      setCategory("Other");
      setFrequency("monthly");
      setAmount("");
      setNextCharge("");
      setSplitBy(1);
      setStatus("");
      setNotes("");
    }
    setShowConfirm(false);
  }, [subscription, open]);

  const myCost = (parseFloat(amount) || 0) / (splitBy || 1);

  async function handleSave() {
    if (!name.trim()) {
      onToast("Enter service name", true);
      return;
    }
    const payload = {
      name: name.trim(),
      category,
      frequency,
      amount: parseFloat(amount) || 0,
      nextCharge: nextCharge || null,
      splitBy,
      status: status || null,
      notes: notes || null,
    };

    try {
      if (subscription) {
        await api.subscriptions.update(subscription.id, payload);
        onToast("Updated");
      } else {
        await api.subscriptions.create(payload);
        onToast("Added");
      }
      onSaved();
      onClose();
    } catch {
      onToast("Failed to save", true);
    }
  }

  async function handleDelete() {
    if (!subscription) return;
    try {
      await api.subscriptions.delete(subscription.id);
      onToast("Deleted");
      onSaved();
      onClose();
    } catch {
      onToast("Failed to delete", true);
    }
  }

  if (showConfirm) {
    return (
      <Modal open={open} onClose={() => setShowConfirm(false)} title={`Remove "${subscription?.name}"?`}>
        <p className="text-sm text-text-dim mb-6">This action cannot be undone.</p>
        <div className="flex justify-end gap-2.5 pt-4 border-t border-border">
          <button className="btn" onClick={() => setShowConfirm(false)}>Cancel</button>
          <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={subscription ? "Edit Bill" : "Add Bill"}>
      <div className="flex flex-col gap-4">
        <div className="input-group">
          <label>Service Name</label>
          <input
            type="text"
            placeholder="e.g. Netflix, Allstate"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <div className="input-group">
            <label>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {SUB_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label>Frequency</label>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <div className="input-group">
            <label>Charge Amount</label>
            <input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label>Next Charge Date</label>
            <input
              type="date"
              value={nextCharge}
              onChange={(e) => setNextCharge(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <div className="input-group">
            <label>Split Between</label>
            <select value={splitBy} onChange={(e) => setSplitBy(parseInt(e.target.value))}>
              <option value={1}>Just me</option>
              <option value={2}>2 people</option>
              <option value={3}>3 people</option>
              <option value={4}>4 people</option>
            </select>
          </div>
          <div className="input-group">
            <label>My Cost</label>
            <div className="font-mono px-3.5 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-green">
              {fmtP(myCost)}
            </div>
          </div>
        </div>

        <div className="input-group">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">None</option>
            <option value="essential">Essential</option>
            <option value="review">Under Review</option>
          </select>
        </div>

        <div className="input-group">
          <label>Notes (optional)</label>
          <textarea
            rows={2}
            placeholder="e.g. Split with mom, seasonal pricing..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2.5 pt-4 border-t border-border max-md:pb-[env(safe-area-inset-bottom)]">
          {subscription && (
            <button className="btn btn-danger btn-sm" onClick={() => setShowConfirm(true)}>
              🗑️ Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>
            {subscription ? "Update" : "Add"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
