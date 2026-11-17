import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { parseNum } from "../../lib/investments";
import Modal from "../layout/Modal";
import type { InvestmentTargets } from "../../types";

interface TargetsFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, err?: boolean) => void;
  targets: InvestmentTargets;
}

const FIELDS: { key: keyof InvestmentTargets; label: string; hint?: string }[] = [
  { key: "usPct", label: "US stocks target (%)" },
  { key: "intlPct", label: "International target (%)" },
  { key: "bondPct", label: "Bonds target (%)" },
  { key: "bandPts", label: "Band (± points)", hint: "A class outside target ± this many points gets flagged" },
  { key: "playCapPct", label: "Play money cap (% of investments)" },
  { key: "singleStockPct", label: "One stock line (% of investments)" },
  { key: "idleCash", label: "Idle cash line ($ per account)" },
  { key: "feeWarnPct", label: "Fund fee line (% a year)" },
];

export default function TargetsForm({ open, onClose, onSaved, onToast, targets }: TargetsFormProps) {
  const [f, setF] = useState<Record<keyof InvestmentTargets, string>>({} as Record<keyof InvestmentTargets, string>);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setF(Object.fromEntries(FIELDS.map(({ key }) => [key, String(targets[key])])) as Record<keyof InvestmentTargets, string>);
  }, [targets, open]);

  async function save() {
    const payload: Partial<InvestmentTargets> = {};
    for (const { key, label } of FIELDS) {
      const n = parseNum(f[key] ?? "");
      if (n == null || n < 0) return onToast(`${label}: type a number`, true);
      payload[key] = n;
    }
    setSaving(true);
    try {
      await api.holdings.saveTargets(payload);
      onToast("Targets saved");
      onSaved();
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
      title="Targets and lines"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>Save</button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[11px] text-text-muted">
          From the written investment policy. A change to the target mix waits 30 days and gets written down with the reason first.
        </p>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          {FIELDS.map(({ key, label, hint }) => (
            <div key={key} className="input-group">
              <label>{label}</label>
              <input
                type="text"
                inputMode="decimal"
                className="font-mono"
                value={f[key] ?? ""}
                onChange={(e) => setF((p) => ({ ...p, [key]: e.target.value }))}
              />
              {hint && <span className="text-[11px] text-text-muted">{hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
