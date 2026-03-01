import { useState, useEffect } from "react";
import Modal from "../layout/Modal";
import { api } from "../../lib/api";
import { fmt, fmtP, fmtDate } from "../../lib/formatters";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onToast: (msg: string, err?: boolean) => void;
  onDataChange: () => void;
}

export default function SettingsModal({ open, onClose, onToast, onDataChange }: SettingsModalProps) {
  const [paycheck, setPaycheck] = useState("");
  const [originalPaycheck, setOriginalPaycheck] = useState(0);
  const [paycheckHistory, setPaycheckHistory] = useState<{ date: string; amount: number }[]>([]);
  const [showDanger, setShowDanger] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.settings.getAll().then((s) => {
      const pc = (s as Record<string, unknown>).paycheck as number || 0;
      setPaycheck(pc ? String(pc) : "");
      setOriginalPaycheck(pc);
      setPaycheckHistory(
        ((s as Record<string, unknown>).paycheckHistory as { date: string; amount: number }[]) || []
      );
    }).catch(() => {});
  }, [open]);

  const pp = parseFloat(paycheck) || 0;

  async function saveIncome() {
    if (pp === originalPaycheck) {
      onToast("No change");
      return;
    }

    // Update history
    const newHistory = [...paycheckHistory];
    if (originalPaycheck) {
      newHistory.push({
        date: new Date().toISOString().slice(0, 10),
        amount: originalPaycheck,
      });
    }

    try {
      await api.settings.set("paycheck", pp);
      await api.settings.set("income", pp * 2);
      await api.settings.set("paycheckHistory", newHistory);
      setOriginalPaycheck(pp);
      setPaycheckHistory(newHistory);
      onDataChange();
      onToast("Income updated");
    } catch {
      onToast("Failed to save", true);
    }
  }

  async function exportJSON() {
    try {
      const data = await api.data.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `finance-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      onToast("Exported");
    } catch {
      onToast("Export failed", true);
    }
  }

  function importJSON() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await api.data.import(data);
        onDataChange();
        onToast("Imported");
      } catch {
        onToast("Invalid file", true);
      }
    };
    input.click();
  }

  async function deleteAll() {
    try {
      // Import empty data to clear everything
      await api.data.import({
        accounts: [],
        subscriptions: [],
        expenses: [],
        paycheck: 0,
        income: 0,
        paycheckHistory: [],
        budgetTargets: {},
      });
      onDataChange();
      onClose();
      onToast("All data deleted");
    } catch {
      onToast("Failed to delete", true);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Settings">
      {/* Income Section */}
      <div className="py-5 border-b border-border">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-dim mb-4">
          Income
        </h3>
        <div className="flex gap-2.5 items-end mb-2">
          <div className="input-group flex-1">
            <label>Per-Paycheck (after tax)</label>
            <input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={paycheck}
              onChange={(e) => setPaycheck(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-sm" onClick={saveIncome}>
            Update
          </button>
        </div>
        <div className="text-[13px] text-text-dim mb-3">
          Semi-monthly (×2) = <span className="font-mono">{fmt(pp * 2)}</span>/mo
        </div>
        <details className="cursor-pointer">
          <summary className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">
            Pay History
          </summary>
          <div className="max-h-[150px] overflow-y-auto">
            {paycheckHistory.length === 0 ? (
              <p className="text-xs text-text-muted py-2">No changes yet</p>
            ) : (
              [...paycheckHistory].reverse().map((h, i) => (
                <div
                  key={i}
                  className="flex justify-between py-1.5 border-b border-border/30 text-xs"
                >
                  <span className="text-text-muted">{fmtDate(h.date)}</span>
                  <span className="font-mono text-text-dim">
                    {fmtP(h.amount)} → {fmtP(h.amount * 2)}/mo
                  </span>
                </div>
              ))
            )}
          </div>
        </details>
      </div>

      {/* Data Section */}
      <div className="py-5 border-b border-border">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-dim mb-4">
          Data
        </h3>
        <div className="flex items-center justify-between gap-4 mb-3 max-md:flex-col max-md:items-stretch">
          <p className="text-[13px] text-text-muted">JSON backup</p>
          <button className="btn max-md:self-start" onClick={exportJSON}>
            📤 Export
          </button>
        </div>
        <div className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch">
          <p className="text-[13px] text-text-muted">Restore from backup</p>
          <button className="btn max-md:self-start" onClick={importJSON}>
            📥 Import
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="py-5">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-dim mb-4">
          Danger Zone
        </h3>
        {!showDanger ? (
          <div className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch">
            <p className="text-[13px] text-red">
              Permanently delete all data. Cannot be undone.
            </p>
            <button className="btn btn-danger max-md:self-start" onClick={() => setShowDanger(true)}>
              🗑️ Delete All
            </button>
          </div>
        ) : (
          <div className="bg-red-dim border border-red/30 rounded-lg p-4">
            <p className="text-sm text-text mb-3">Are you sure? This cannot be undone.</p>
            <div className="flex gap-2">
              <button className="btn btn-sm" onClick={() => setShowDanger(false)}>Cancel</button>
              <button className="btn btn-danger btn-sm" onClick={deleteAll}>Yes, delete everything</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
