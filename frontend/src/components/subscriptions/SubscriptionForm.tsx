import { useState, useEffect } from "react";
import Modal from "../layout/Modal";
import Confirm from "../layout/Confirm";
import { api } from "../../lib/api";
import { fmtDate, fmtP, today as todayStr } from "../../lib/formatters";
import { computeEffectiveNextCharge, billState, type BillState } from "../../lib/billing";
import type { BillProjection, Subscription } from "../../types";
import { SUB_CATEGORIES } from "../../types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10" → "Oct 2026"; full dates go through fmtDate */
function historyLabel(label: string): string {
  if (label.length === 7) {
    const [y, m] = label.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  return fmtDate(label);
}

/** Recent charges as small bars, newest on the right; hover a bar for its month and amount */
function ChargeBars({ history }: { history: BillProjection["history"] }) {
  const max = Math.max(...history.map((h) => h.amount), 0);
  if (!history.length || max <= 0) return null;
  return (
    <div className="flex items-end gap-[3px] h-9" role="img" aria-label={`Last ${history.length} charges`}>
      {history.map((h) => (
        <div
          key={h.label}
          title={`${historyLabel(h.label)}: ${fmtP(h.amount)}`}
          className="flex-1 max-w-[18px] rounded-t-[3px] bg-accent/60 hover:bg-accent min-h-[2px]"
          style={{ height: `${Math.max(6, (h.amount / max) * 100)}%` }}
        />
      ))}
    </div>
  );
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
  const [state, setState] = useState<BillState>("active");
  const [stateSince, setStateSince] = useState("");
  const [notes, setNotes] = useState("");
  const [pinned, setPinned] = useState(false);
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
      setState(billState(subscription));
      setStateSince(subscription.stateSince || "");
      setNotes(subscription.notes || "");
      setPinned(subscription.amountMode === "listed");
    } else {
      setName("");
      setCategory("Other");
      setFrequency("monthly");
      setAmount("");
      setNextCharge("");
      setSplitBy(1);
      setStatus("");
      setState("active");
      setStateSince("");
      setNotes("");
      setPinned(false);
    }
    setShowConfirm(false);
  }, [subscription, open]);

  // Totals use what history projects, unless pinned to the typed amount (or there's no projection yet)
  const projection = subscription?.projection ?? null;
  const usesProjection = !pinned && !!projection && projection.method !== "listed";
  const counted = usesProjection ? projection!.amount : parseFloat(amount) || 0;
  const myCost = counted / (splitBy || 1);

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
      state: state === "active" ? null : state,
      stateSince: state === "active" ? null : stateSince || todayStr(),
      notes: notes || null,
      amountMode: pinned ? ("listed" as const) : null,
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
      <Confirm
        open={open}
        title={`Remove "${subscription?.name}"?`}
        message="This action cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => setShowConfirm(false)}
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={subscription ? "Edit Bill" : "Add Bill"}
      footer={
        <>
          {subscription && (
            <button className="btn btn-danger btn-sm mr-auto" onClick={() => setShowConfirm(true)}>
              🗑️ Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>
            {subscription ? "Update" : "Add"}
          </button>
        </>
      }
    >
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
            <label>Listed Amount</label>
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

        {projection && (
          <div className="rounded-lg border border-border bg-bg-input px-3.5 py-3 flex flex-col gap-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  {usesProjection ? "Counts as (projected)" : "Counts as (listed)"}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {projection.method === "listed"
                    ? projection.basis
                    : pinned
                      ? `History projects ${fmtP(projection.amount)}: ${projection.basis}`
                      : projection.basis}
                </div>
              </div>
              <div className="font-mono text-sm shrink-0">{fmtP(counted)}</div>
            </div>
            <ChargeBars history={projection.history} />
            {projection.method !== "listed" && (
              <label className="flex items-center gap-2 text-xs text-text-dim cursor-pointer">
                <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
                Use the listed amount instead
              </label>
            )}
          </div>
        )}

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

        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <div className="input-group">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">None</option>
              <option value="essential">Essential</option>
              <option value="review">Under Review</option>
            </select>
          </div>
          <div className="input-group">
            <label>Paying it?</label>
            <select
              value={state}
              onChange={(e) => {
                const next = e.target.value as BillState;
                setState(next);
                if (next !== "active" && !stateSince) setStateSince(todayStr());
              }}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {state !== "active" && (
          <div className="input-group">
            <label>{state === "paused" ? "Paused since" : "Cancelled since"}</label>
            <input type="date" value={stateSince} onChange={(e) => setStateSince(e.target.value)} />
            <span className="text-[11px] text-text-muted">
              Left out of your totals and pay periods. Bills check flags any charge after this date.
            </span>
          </div>
        )}

        <div className="input-group">
          <label>Notes (optional)</label>
          <textarea
            rows={2}
            placeholder="e.g. Split with mom, seasonal pricing..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
