import { useState, useEffect } from "react";
import Modal from "../layout/Modal";
import Confirm from "../layout/Confirm";
import { api } from "../../lib/api";
import { today } from "../../lib/formatters";
import type { CreditCard, RewardUnit, StatementAccount } from "../../types";

interface CardFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, err?: boolean) => void;
  card?: CreditCard | null;
  /** Every card, to show which statement accounts are already linked */
  cards: CreditCard[];
  statementAccounts: StatementAccount[];
  /** Categories seen in spending, offered in the rate editor */
  categories: string[];
}

type RateRow = { category: string; rate: string; cap: string };

export default function CardForm({ open, onClose, onSaved, onToast, card, cards, statementAccounts, categories }: CardFormProps) {
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [accountId, setAccountId] = useState("");
  const [annualFee, setAnnualFee] = useState("");
  const [unit, setUnit] = useState<RewardUnit>("percent");
  const [pointValue, setPointValue] = useState("");
  const [otherRate, setOtherRate] = useState("");
  const [rates, setRates] = useState<RateRow[]>([]);
  const [benefits, setBenefits] = useState("");
  const [lastReviewed, setLastReviewed] = useState("");
  const [inUse, setInUse] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const r = card?.rewardRates ?? {};
    setName(card?.name || "");
    setIssuer(card?.issuer || "");
    setAccountId(card?.statementAccountId || "");
    setAnnualFee(card?.annualFee ? String(card.annualFee) : "");
    setUnit(card?.rewardUnit || "percent");
    setPointValue(card?.pointValue != null ? String(card.pointValue) : "");
    setOtherRate(r["*"] != null ? String(r["*"]) : "");
    setRates(
      Object.entries(r)
        .filter(([k]) => k !== "*")
        .map(([category, rate]) => ({ category, rate: String(rate), cap: card?.rewardCaps?.[category] ? String(card.rewardCaps[category]) : "" }))
    );
    setBenefits(card?.benefits || "");
    setLastReviewed(card?.lastReviewed || "");
    setInUse(card ? card.inUse : true);
    setShowConfirm(false);
  }, [card, open]);

  const linkedTo = new Map(cards.filter((c) => c.id !== card?.id && c.statementAccountId).map((c) => [c.statementAccountId!, c.name]));
  const creditAccounts = statementAccounts.filter((a) => a.kind === "credit" || a.id === accountId);
  const suffix = unit === "points" ? "x" : "%";

  function setRow(i: number, patch: Partial<RateRow>) {
    setRates((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    if (!name.trim()) return onToast("Enter a card name", true);

    const rewardRates: Record<string, number> = {};
    const rewardCaps: Record<string, number> = {};
    for (const r of rates) {
      const category = r.category.trim();
      if (!category && !r.rate) continue;
      const rate = parseFloat(r.rate);
      if (!category) return onToast("Each rate needs a category", true);
      if (!Number.isFinite(rate) || rate < 0) return onToast(`Enter a rate for ${category}`, true);
      if (Object.keys(rewardRates).some((k) => k.toLowerCase() === category.toLowerCase())) {
        return onToast(`${category} is listed twice`, true);
      }
      rewardRates[category] = rate;
      if (r.cap.trim() !== "") {
        const cap = parseFloat(r.cap);
        if (!Number.isFinite(cap) || cap <= 0) return onToast(`Enter a yearly cap for ${category}, or leave it blank`, true);
        rewardCaps[category] = cap;
      }
    }
    if (otherRate !== "") {
      const rate = parseFloat(otherRate);
      if (!Number.isFinite(rate) || rate < 0) return onToast("Enter a rate for everything else", true);
      rewardRates["*"] = rate;
    }

    const payload: Partial<CreditCard> = {
      name: name.trim(),
      issuer: issuer.trim() || null,
      statementAccountId: accountId || null,
      annualFee: parseFloat(annualFee) || 0,
      rewardUnit: unit,
      pointValue: unit === "points" && pointValue !== "" ? parseFloat(pointValue) : null,
      rewardRates,
      rewardCaps,
      benefits: benefits.trim() || null,
      lastReviewed: lastReviewed || null,
      inUse,
    };

    setSaving(true);
    try {
      if (card) {
        await api.cards.update(card.id, payload);
        onToast("Card updated");
      } else {
        await api.cards.create(payload);
        onToast("Card added");
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
    if (!card) return;
    try {
      await api.cards.delete(card.id);
      onToast("Card deleted");
      onSaved();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to delete", true);
    }
  }

  if (showConfirm) {
    return (
      <Confirm
        open={open}
        title={`Delete "${card?.name}"?`}
        message="This removes the card and its reward notes. Its imported transactions stay as they are."
        onConfirm={handleDelete}
        onCancel={() => setShowConfirm(false)}
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={card ? "Edit Card" : "Add Card"}
      footer={
        <>
          {card && (
            <button className="btn btn-danger btn-sm mr-auto" onClick={() => setShowConfirm(true)}>
              🗑️ Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {card ? "Update" : "Add"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <div className="input-group">
            <label>Card Name</label>
            <input type="text" placeholder="e.g. Apple Card" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Issuer</label>
            <input type="text" placeholder="e.g. Chase" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <div className="input-group">
            <label>Imported Statements</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Not linked</option>
              {creditAccounts.map((a) => (
                <option key={a.id} value={a.id} disabled={linkedTo.has(a.id)}>
                  {a.name}
                  {a.last4 && !a.name.includes(a.last4) ? ` ··${a.last4}` : ""}
                  {linkedTo.has(a.id) ? ` (linked to ${linkedTo.get(a.id)})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label>Annual Fee</label>
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={annualFee}
              onChange={(e) => setAnnualFee(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <div className="input-group">
            <label>Rewards Are</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value as RewardUnit)}>
              <option value="percent">Cash back (% of spend)</option>
              <option value="points">Points (per dollar)</option>
            </select>
          </div>
          {unit === "points" && (
            <div className="input-group">
              <label>Cents per Point</label>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                placeholder="1.00"
                value={pointValue}
                onChange={(e) => setPointValue(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="input-group">
          <label>Reward Rates by Category</label>
          <span className="text-[11px] text-text-muted -mt-0.5">
            For a store-specific rate, type @ and the payee name, like @Amazon. Store rates beat category rates. The last box is an optional yearly cap in dollars, after which the everything-else rate applies.
          </span>
          <datalist id="card-rate-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <div className="flex flex-col gap-2">
            {rates.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  list="card-rate-categories"
                  placeholder="Category"
                  value={r.category}
                  onChange={(e) => setRow(i, { category: e.target.value })}
                />
                <RateInput value={r.rate} suffix={suffix} onChange={(rate) => setRow(i, { rate })} />
                <input
                  type="number"
                  step="1"
                  inputMode="decimal"
                  placeholder="No cap"
                  title="Yearly spend this rate covers, then everything-else rate"
                  aria-label={`Yearly cap for ${r.category || "this rate"}`}
                  className="!w-[104px] shrink-0"
                  value={r.cap}
                  onChange={(e) => setRow(i, { cap: e.target.value })}
                />
                <button
                  className="btn btn-sm shrink-0 !px-2.5"
                  title="Remove"
                  onClick={() => setRates((rs) => rs.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <div className="flex-1 text-sm text-text-dim px-1">Everything else</div>
              <RateInput value={otherRate} suffix={suffix} onChange={setOtherRate} />
              <div className="w-[104px] shrink-0" aria-hidden />
              <button className="btn btn-sm shrink-0 !px-2.5 invisible" tabIndex={-1} aria-hidden>
                ✕
              </button>
            </div>
            <button
              className="btn btn-sm self-start"
              onClick={() => setRates((rs) => [...rs, { category: "", rate: "", cap: "" }])}
            >
              + Add category or store
            </button>
          </div>
          <p className="text-[11px] text-text-muted leading-relaxed">
            Categories match the ones on your transactions. Any category not listed earns the “everything else” rate.
          </p>
        </div>

        <div className="input-group">
          <label>Benefits &amp; Notes</label>
          <textarea
            rows={3}
            placeholder="e.g. No foreign transaction fees, cell phone protection, $10/mo dining credit"
            value={benefits}
            onChange={(e) => setBenefits(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3 items-end">
          <div className="input-group">
            <label>Terms Last Reviewed</label>
            <div className="flex items-center gap-2">
              <input type="date" value={lastReviewed} onChange={(e) => setLastReviewed(e.target.value)} />
              <button className="btn btn-sm shrink-0" onClick={() => setLastReviewed(today())}>Today</button>
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-sm text-text-dim cursor-pointer py-2.5">
            <input type="checkbox" checked={inUse} onChange={(e) => setInUse(e.target.checked)} />
            Still in use
          </label>
        </div>
      </div>
    </Modal>
  );
}

function RateInput({ value, suffix, onChange }: { value: string; suffix: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-[96px] shrink-0">
      <input
        type="number"
        step="0.1"
        inputMode="decimal"
        placeholder="0"
        className="!pr-7"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted pointer-events-none">{suffix}</span>
    </div>
  );
}
