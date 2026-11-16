import { useEffect, useMemo, useState } from "react";
import { fmt } from "../../lib/formatters";
import { defaultUpgradeInputs, upgradeMath, type UpgradeInputs } from "../../lib/cars";
import MoneyInput from "../layout/MoneyInput";
import type { UpgradeContext, VehicleSummary } from "../../types";

interface UpgradeCalculatorProps {
  cars: VehicleSummary[];
  context: UpgradeContext;
}

const STORE = "cars.upgrade";

function load(): Partial<UpgradeInputs> & { carId?: string } {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "{}");
  } catch {
    return {};
  }
}

/**
 * Keep or replace: what each costs a year, the repair bill at which they cost the same, and
 * whether the cash side works with the emergency fund and open goals left intact.
 * Plain arithmetic on your own numbers and assumptions; every input can be changed.
 */
export default function UpgradeCalculator({ cars, context }: UpgradeCalculatorProps) {
  const owned = cars.filter((c) => !c.vehicle.soldDate);
  const saved = useMemo(load, []);
  const [carId, setCarId] = useState(saved.carId && owned.some((c) => c.vehicle.id === saved.carId) ? saved.carId : owned[0]?.vehicle.id || "");
  const current = owned.find((c) => c.vehicle.id === carId) || null;
  const [inputs, setInputs] = useState<Record<keyof UpgradeInputs, string>>(() => {
    const d = { ...defaultUpgradeInputs(current), ...pickSaved(saved) };
    return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, String(v)])) as Record<keyof UpgradeInputs, string>;
  });

  // A different car brings its own trade-in value and repair history
  useEffect(() => {
    const d = defaultUpgradeInputs(current);
    setInputs((p) => ({ ...p, tradeIn: String(d.tradeIn), keepUpkeep: String(d.keepUpkeep) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carId]);

  const values = Object.fromEntries(
    Object.entries(inputs).map(([k, v]) => [k, parseFloat(v.replace(/[$,]/g, "")) || 0])
  ) as unknown as UpgradeInputs;

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ ...values, carId }));
    } catch {
      // Storage unavailable: inputs just won't be remembered
    }
  });

  const r = upgradeMath(values, current, context);
  const set = (k: keyof UpgradeInputs) => (v: string) => setInputs((p) => ({ ...p, [k]: v }));

  if (!owned.length) {
    return <p className="text-xs text-text-muted">Add a car to compare keeping it with replacing it.</p>;
  }

  const money = (k: keyof UpgradeInputs, label: string) => (
    <div className="input-group">
      <label>{label}</label>
      <MoneyInput value={inputs[k]} onChange={set(k)} />
    </div>
  );
  const plain = (k: keyof UpgradeInputs, label: string) => (
    <div className="input-group">
      <label>{label}</label>
      <input type="text" inputMode="decimal" value={inputs[k]} onChange={(e) => set(k)(e.target.value)} />
    </div>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-lg:grid-cols-1 gap-6">
      <div className="flex flex-col gap-3">
        <div className="input-group">
          <label>Replace</label>
          <select value={carId} onChange={(e) => setCarId(e.target.value)}>
            {owned.map((c) => <option key={c.vehicle.id} value={c.vehicle.id}>{c.vehicle.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {money("price", "Replacement price")}
          {money("tradeIn", "Current car brings")}
          {plain("years", "Keep it (years)")}
          {plain("resalePct", "Worth after, % of price")}
          {money("loanAmount", "Financed (0 = cash)")}
          {plain("loanRate", "APR %")}
          {plain("loanMonths", "Loan months")}
          {money("insuranceChange", "Insurance change / yr")}
          {money("keepUpkeep", "Repairs / yr if kept")}
          {money("newUpkeep", "Repairs / yr if replaced")}
          {plain("keepDepreciationPct", "Current car loses % / yr")}
          {plain("emergencyMonths", "Emergency fund (months)")}
        </div>
        <p className="text-[11px] text-text-muted">
          Repairs if kept starts from this car's last two years ({fmt(current?.upkeepLast12)} and {fmt(current?.upkeepPrior12)}).
          Gas and registration are treated as the same either way.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Result label="Keep: per year" value={fmt(r.keepPerYear)} hint={`${fmt(values.keepUpkeep)} repairs + ${fmt(r.keepDepreciation)} value lost`} />
          <Result
            label="Replace: per year"
            value={fmt(r.replacePerYear)}
            hint={`${fmt(r.replaceDepreciation)} value lost${r.interestPerYear ? ` + ${fmt(r.interestPerYear)} interest` : ""} + ${fmt(values.newUpkeep)} repairs`}
          />
        </div>
        <div className={`rounded-lg border px-4 py-3 text-sm ${r.keepSaves >= 0 ? "border-green/30 bg-green-dim" : "border-amber/30 bg-amber/10"}`}>
          {r.keepSaves >= 0 ? (
            <>Keeping costs about <b className="font-mono">{fmt(r.keepSaves)}</b> a year less.</>
          ) : (
            <>Replacing costs about <b className="font-mono">{fmt(-r.keepSaves)}</b> a year less.</>
          )}
          <div className="text-xs text-text-dim mt-1">
            They cost the same when this car needs about <b className="font-mono text-text">{fmt(Math.max(0, r.breakEvenUpkeep))}</b> a year in repairs.
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">The cash side</div>
          <div className="bg-bg-input border border-border rounded-lg text-xs">
            <Row label="Checking and savings" value={fmt(context.liquidCash)} />
            <Row label={`Emergency fund (${values.emergencyMonths} mo of ${fmt(context.monthlySpending)})`} value={`− ${fmt(r.emergencyFund)}`} />
            <Row label={`Open goals (${context.goals.length})`} value={`− ${fmt(context.goalsRemaining)}`} />
            <Row label="Free before the car" value={fmt(r.cushion)} strong />
            <Row label="Cash needed (price − trade-in − loan)" value={`− ${fmt(r.cashNeeded)}`} />
            <Row label="Free after" value={fmt(r.cushionAfter)} strong tone={r.cushionAfter < 0 ? "red" : "green"} />
            {r.monthlyPayment > 0 && (
              <>
                <Row label="Monthly payment" value={fmt(r.monthlyPayment)} />
                <Row
                  label={`Left each month (now ${fmt(r.monthlySurplus)})`}
                  value={fmt(r.monthlySurplusAfter)}
                  strong
                  tone={r.monthlySurplusAfter < 0 ? "red" : "green"}
                />
              </>
            )}
          </div>
          <p className="text-[11px] text-text-muted mt-2">
            Spending and income are 12-month averages from imported accounts; balances come from the Assets page.
            {context.liquidAccounts.length === 0 && " No checking or savings accounts on the Assets page yet."}
          </p>
        </div>
      </div>
    </div>
  );
}

function pickSaved(s: Partial<UpgradeInputs> & { carId?: string }): Partial<UpgradeInputs> {
  // Trade-in and kept repairs follow the selected car; everything else is the user's own assumptions
  const { carId: _c, tradeIn: _t, keepUpkeep: _k, ...rest } = s;
  return rest;
}

function Result({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-bg-input border border-border rounded-lg px-3.5 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{label}</div>
      <div className="font-mono text-xl font-semibold mt-0.5">{value}</div>
      <div className="text-[11px] text-text-muted">{hint}</div>
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "red" | "green" }) {
  return (
    <div className={`flex justify-between gap-3 px-3.5 py-2 border-b border-border/40 last:border-0 ${strong ? "bg-white/[0.02]" : ""}`}>
      <span className={strong ? "text-text" : "text-text-dim"}>{label}</span>
      <span className={`font-mono shrink-0 ${tone === "red" ? "text-red" : tone === "green" ? "text-green" : ""} ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
