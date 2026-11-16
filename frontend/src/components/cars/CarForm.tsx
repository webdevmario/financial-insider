import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmt } from "../../lib/formatters";
import Modal from "../layout/Modal";
import MoneyInput from "../layout/MoneyInput";
import Confirm from "../layout/Confirm";
import type { Account, Vehicle } from "../../types";

interface CarFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, err?: boolean) => void;
  car: Vehicle | null;
  /** Vehicle assets on the Assets page, to take the current value from */
  assets: Account[];
}

type Fields = Record<
  | "name" | "year" | "make" | "model" | "vin" | "plate" | "driver" | "accountId"
  | "purchaseDate" | "purchasePrice" | "purchaseMileage" | "purchasedFrom" | "tradeInValue"
  | "loanAmount" | "loanRate" | "loanMonths" | "interestPaid"
  | "soldDate" | "salePrice" | "saleMileage" | "valueEstimate" | "valueDate" | "notes",
  string
>;

const EMPTY: Fields = {
  name: "", year: "", make: "", model: "", vin: "", plate: "", driver: "", accountId: "",
  purchaseDate: "", purchasePrice: "", purchaseMileage: "", purchasedFrom: "", tradeInValue: "",
  loanAmount: "", loanRate: "", loanMonths: "", interestPaid: "",
  soldDate: "", salePrice: "", saleMileage: "", valueEstimate: "", valueDate: "", notes: "",
};

function fromCar(car: Vehicle | null): Fields {
  if (!car) return EMPTY;
  const out = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof Fields)[]) {
    const v = car[k as keyof Vehicle];
    out[k] = v == null ? "" : String(v);
  }
  return out;
}

const NUMERIC: (keyof Fields)[] = [
  "year", "purchasePrice", "purchaseMileage", "tradeInValue", "loanAmount", "loanRate", "loanMonths",
  "interestPaid", "salePrice", "saleMileage", "valueEstimate",
];

export default function CarForm({ open, onClose, onSaved, onToast, car, assets }: CarFormProps) {
  const [f, setF] = useState<Fields>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    setF(fromCar(car));
    setConfirm(false);
  }, [car, open]);

  const set = (k: keyof Fields) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const asset = assets.find((a) => a.id === f.accountId);

  async function save() {
    if (!f.name.trim()) return onToast("Give the car a name", true);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) {
      payload[k] = v.trim() === "" ? null : NUMERIC.includes(k as keyof Fields) ? parseFloat(v.replace(/[$,]/g, "")) : v.trim();
    }
    setSaving(true);
    try {
      if (car) await api.cars.update(car.id, payload as Partial<Vehicle>);
      else await api.cars.create(payload as Partial<Vehicle>);
      onToast(car ? "Car updated" : "Car added");
      onSaved();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to save", true);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!car) return;
    try {
      await api.cars.delete(car.id);
      onToast("Car removed");
      onSaved();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to delete", true);
    }
  }

  const text = (k: keyof Fields, label: string, placeholder = "", extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="input-group">
      <label>{label}</label>
      <input type="text" placeholder={placeholder} value={f[k]} onChange={(e) => set(k)(e.target.value)} {...extra} />
    </div>
  );
  const money = (k: keyof Fields, label: string, placeholder?: string) => (
    <div className="input-group">
      <label>{label}</label>
      <MoneyInput value={f[k]} onChange={set(k)} placeholder={placeholder} />
    </div>
  );
  const whole = (k: keyof Fields, label: string, placeholder = "") => text(k, label, placeholder, { inputMode: "numeric" });
  const day = (k: keyof Fields, label: string) => (
    <div className="input-group">
      <label>{label}</label>
      <input type="date" value={f[k]} onChange={(e) => set(k)(e.target.value)} />
    </div>
  );
  const section = (title: string, hint?: string) => (
    <div className="pt-2 border-t border-border/60">
      <div className="text-[12px] font-semibold text-text">{title}</div>
      {hint && <div className="text-[11px] text-text-muted mt-0.5">{hint}</div>}
    </div>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        variant="form"
        title={car ? `Edit ${car.name}` : "Add Car"}
        aside={car && <button className="btn btn-danger btn-sm" onClick={() => setConfirm(true)}>🗑️ Remove</button>}
        footer={
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{car ? "Update" : "Add"}</button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {text("name", "Name", "e.g. Vivian's Highlander", { autoCapitalize: "words" })}
          <div className="grid grid-cols-3 max-md:grid-cols-2 gap-3">
            {whole("year", "Year", "2018")}
            {text("make", "Make", "Toyota")}
            {text("model", "Model", "Highlander")}
          </div>
          <div className="grid grid-cols-3 max-md:grid-cols-1 gap-3">
            {text("driver", "Main driver")}
            {text("plate", "Plate")}
            {text("vin", "VIN", "", { autoCapitalize: "characters" })}
          </div>

          {section("Bought", "Out-the-door price: price plus tax, title and dealer fees, before any trade-in.")}
          <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
            {day("purchaseDate", "Date")}
            {money("purchasePrice", "Out-the-door price")}
            {whole("purchaseMileage", "Mileage")}
            {text("purchasedFrom", "From", "Dealer or seller")}
            {money("tradeInValue", "Trade-in toward it")}
          </div>

          {section("Loan", "Leave empty if you paid cash. Interest is estimated from these until you type what was really paid.")}
          <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
            {money("loanAmount", "Amount financed")}
            {text("loanRate", "APR %", "4.9", { inputMode: "decimal" })}
            {whole("loanMonths", "Term (months)", "60")}
            {money("interestPaid", "Interest paid (if known)")}
          </div>

          {section("Current value")}
          <div className="input-group">
            <label>Value from an asset</label>
            <select value={f.accountId} onChange={(e) => set("accountId")(e.target.value)}>
              <option value="">None: type an estimate below</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.type}{a.owner ? ` · ${a.owner}` : ""} · {fmt(a.balance)}
                </option>
              ))}
            </select>
          </div>
          {asset ? (
            <div className="text-[11px] text-text-muted -mt-2">Update the value on the Assets page; it shows here.</div>
          ) : (
            <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
              {money("valueEstimate", "Estimated value")}
              {day("valueDate", "As of")}
            </div>
          )}

          {section("Sold", "Fill in once the car is sold or traded in.")}
          <div className="grid grid-cols-3 max-md:grid-cols-1 gap-3">
            {day("soldDate", "Date")}
            {money("salePrice", "Sale or trade-in value")}
            {whole("saleMileage", "Mileage")}
          </div>

          <div className="input-group">
            <label>Notes</label>
            <textarea rows={2} value={f.notes} onChange={(e) => set("notes")(e.target.value)} />
          </div>
        </div>
      </Modal>
      <Confirm
        open={open && confirm}
        title={`Remove ${car?.name}?`}
        message="Its documents stay in the folder and on the list, just not assigned to a car. Charges assigned to it go back to unassigned."
        confirmLabel="Remove"
        onConfirm={remove}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
