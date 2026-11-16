import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDate, fmtP } from "../../lib/formatters";
import { ASSIGNABLE_TYPES, COST_LABELS } from "../../lib/cars";
import Modal from "../layout/Modal";
import Segmented from "../layout/Segmented";
import Confirm from "../layout/Confirm";
import type { CarCharge, CarGaps, CarRule, CostType, Vehicle } from "../../types";

type Group = CarGaps["unassigned"][number];

interface AssignModalProps {
  /** A merchant's unassigned charges to assign, or an existing rule to edit */
  target: { group: Group } | { rule: CarRule } | null;
  cars: Vehicle[];
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, err?: boolean) => void;
}

type Split = "one" | "even" | "custom";
type Scope = "all" | "pick";

/** A sensible cost type for a merchant's charges */
function guessType(g: Group): CostType {
  const m = g.merchant.toLowerCase();
  if (g.category === "Gas") return "fuel";
  if (/park|garage|toll|ez ?tag|meter/.test(m)) return "parking";
  if (/registration|county|dps|dmv|inspection|court/.test(m)) return "registration";
  if (/tire/.test(m)) return "tires";
  if (/oil|lube|wash|filter/.test(m)) return "maintenance";
  if (/insur|mutual|casualty/.test(m)) return "insurance";
  return "repair";
}

/**
 * Assign car charges: every charge from a merchant (now and later) through a rule, split across
 * cars when it can't be told apart (gas, a two-car policy), or picked charges to one car.
 */
export default function AssignModal({ target, cars, onClose, onSaved, onToast }: AssignModalProps) {
  const group = target && "group" in target ? target.group : null;
  const rule = target && "rule" in target ? target.rule : null;
  const [costType, setCostType] = useState<CostType>("repair");
  const [split, setSplit] = useState<Split>("one");
  const [carId, setCarId] = useState("");
  const [shares, setShares] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<Scope>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [charges, setCharges] = useState<CarCharge[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!target) return;
    const active = cars.filter((c) => !c.soldDate);
    if (rule) {
      setCostType(rule.costType);
      const ids = rule.shares ? Object.keys(rule.shares).filter((id) => rule.shares![id] > 0) : [];
      setSplit(!rule.shares ? "even" : ids.length === 1 ? "one" : "custom");
      setCarId(ids.length === 1 ? ids[0] : active[0]?.id || "");
      setShares(Object.fromEntries(Object.entries(rule.shares || {}).map(([k, v]) => [k, String(v)])));
      setDateFrom(rule.dateFrom || "");
      setDateTo(rule.dateTo || "");
    } else if (group) {
      const type = guessType(group);
      setCostType(type);
      setSplit(type === "fuel" || type === "insurance" || type === "registration" ? "even" : "one");
      setCarId(active[0]?.id || cars[0]?.id || "");
      setShares({});
      setDateFrom("");
      setDateTo("");
    }
    setScope("all");
    setCharges(null);
    setPicked(new Set());
    setConfirm(false);
    // Reset only when a different charge group or rule opens, not when the car list reloads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => {
    if (!group || scope !== "pick" || charges) return;
    api.cars.charges(group.payeeId ? { payeeId: group.payeeId } : { merchant: group.merchant })
      .then(setCharges)
      .catch((err) => onToast(err instanceof Error ? err.message : "Failed to load charges", true));
  }, [group, scope, charges, onToast]);

  function sharesPayload(): Record<string, number> | null {
    if (split === "even") return null;
    if (split === "one") return { [carId]: 1 };
    const out: Record<string, number> = {};
    for (const [id, w] of Object.entries(shares)) {
      const n = parseFloat(w);
      if (n > 0) out[id] = n;
    }
    return out;
  }

  async function save() {
    if (split === "one" && !carId) return onToast("Pick a car", true);
    const s = sharesPayload();
    if (split === "custom" && (!s || !Object.keys(s).length)) return onToast("Give at least one car a share", true);
    setSaving(true);
    try {
      if (rule) {
        await api.cars.updateRule(rule.id, { costType, shares: s, dateFrom: dateFrom || null, dateTo: dateTo || null });
        onToast("Rule updated");
      } else if (group && scope === "pick") {
        if (!picked.size) return onToast("Pick at least one charge", true);
        if (split !== "one") return onToast("Picked charges go to one car; use every charge to split", true);
        const r = await api.cars.link({ transactionIds: [...picked], vehicleId: carId, costType });
        onToast(`${r.linked} charge${r.linked === 1 ? "" : "s"} assigned`);
      } else if (group) {
        await api.cars.createRule({
          matchType: group.payeeId ? "payee" : "merchant",
          matchValue: group.payeeId || group.merchant,
          costType,
          shares: s,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          notes: group.merchant,
        });
        onToast(`${group.merchant} assigned`);
      }
      onSaved();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to save", true);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!rule) return;
    try {
      await api.cars.deleteRule(rule.id);
      onToast("Rule removed");
      onSaved();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed", true);
    }
  }

  const title = rule ? `Shared cost: ${rule.notes || rule.matchValue}` : group ? `Assign ${group.merchant}` : "";

  return (
    <>
      <Modal
        open={!!target}
        onClose={onClose}
        variant="form"
        title={title}
        aside={rule && <button className="btn btn-danger btn-sm" onClick={() => setConfirm(true)}>🗑️ Remove</button>}
        footer={
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>Save</button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {group && (
            <p className="text-xs text-text-dim">
              {group.count} charge{group.count === 1 ? "" : "s"}, {fmtP(group.total)}, {fmtDate(group.first)} to {fmtDate(group.last)}.
            </p>
          )}

          <div className="input-group">
            <label>Counts as</label>
            <select value={costType} onChange={(e) => setCostType(e.target.value as CostType)}>
              {ASSIGNABLE_TYPES.map((t) => <option key={t} value={t}>{COST_LABELS[t]}</option>)}
            </select>
          </div>

          <div className="input-group">
            <label>Which car</label>
            <Segmented<Split>
              value={split}
              onChange={setSplit}
              full
              options={[
                { value: "one", label: "One car" },
                { value: "even", label: "Split evenly" },
                { value: "custom", label: "Custom split", disabled: scope === "pick" },
              ]}
            />
            {split === "one" && (
              <select value={carId} onChange={(e) => setCarId(e.target.value)} className="mt-1">
                {cars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {split === "even" && (
              <p className="text-[11px] text-text-muted">Each charge is split across the cars you owned that day.</p>
            )}
            {split === "custom" && (
              <div className="flex flex-col gap-2 mt-1">
                {cars.map((c) => (
                  <div key={c.id} className="flex items-center gap-3">
                    <span className="flex-1 text-xs text-text-dim truncate">{c.name}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="!w-24 !py-1.5 !text-sm"
                      placeholder="0"
                      value={shares[c.id] || ""}
                      onChange={(e) => setShares((p) => ({ ...p, [c.id]: e.target.value }))}
                    />
                  </div>
                ))}
                <p className="text-[11px] text-text-muted">Weights: 2 and 1 gives two thirds and one third. A car not owned on a charge's date is left out.</p>
              </div>
            )}
          </div>

          {group && (
            <div className="input-group">
              <label>Which charges</label>
              <Segmented<Scope>
                value={scope}
                onChange={(v) => { setScope(v); if (v === "pick" && split === "custom") setSplit("one"); }}
                full
                options={[
                  { value: "all", label: "Every charge, also future" },
                  { value: "pick", label: "Pick charges" },
                ]}
              />
              {scope === "pick" && (
                <div className="bg-bg-input border border-border rounded-lg mt-1">
                  {!charges ? (
                    <div className="px-3.5 py-2.5 text-xs text-text-muted">Loading…</div>
                  ) : (
                    charges.map((c) => (
                      <label key={c.id} className="flex items-center gap-3 px-3.5 py-2 text-xs border-b border-border/40 last:border-0 cursor-pointer normal-case tracking-normal font-normal">
                        <input
                          type="checkbox"
                          checked={picked.has(c.id)}
                          onChange={(e) => setPicked((p) => {
                            const n = new Set(p);
                            if (e.target.checked) n.add(c.id); else n.delete(c.id);
                            return n;
                          })}
                        />
                        <span className="flex-1 text-text-dim">{fmtDate(c.date)}</span>
                        <span className="font-mono text-text">{fmtP(c.amount)}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {(rule || scope === "all") && (
            <div className="grid grid-cols-2 gap-3">
              <div className="input-group">
                <label>From (optional)</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="input-group">
                <label>Until (optional)</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
          )}
        </div>
      </Modal>
      <Confirm
        open={!!rule && confirm}
        title="Remove this rule?"
        message="Its charges go back to unassigned. Charges you assigned one by one stay."
        confirmLabel="Remove"
        onConfirm={remove}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
