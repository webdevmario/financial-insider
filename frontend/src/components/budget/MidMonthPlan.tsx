import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "../layout/Modal";
import { api } from "../../lib/api";
import { fmt, fmtDate, moLabel } from "../../lib/formatters";
import type { MidMonthPlan as PlanData, PlanLine } from "../../types";

/** What the household saves for a month's plan; the data suggests the lines, these are the edits */
interface SavedPlan {
  ally: number | null;
  reserve: number;
  /** Amount changes by line key */
  amounts: Record<string, number>;
  /** Suggested lines switched off */
  off: string[];
  /** Work expenses switched on (they're off by default: reimbursed on the 1st) */
  workOn: string[];
  extras: { id: string; label: string; amount: number }[];
  savedAt?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
/** "Nov 9": the saved time is UTC, so read it back in local time */
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
const PLANS_KEY = "budgetPlans";
const DEFAULT_RESERVE = 2300;
const CUSHION = 1000;

const blankPlan = (): SavedPlan => ({ ally: null, reserve: DEFAULT_RESERVE, amounts: {}, off: [], workOn: [], extras: [] });

function AmountInput({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number"
      step="0.01"
      inputMode="decimal"
      value={text}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseFloat(e.target.value);
        if (!isNaN(n)) onChange(n);
      }}
      onBlur={() => setText(String(value))}
      className={`!w-28 shrink-0 !py-1.5 !px-2.5 text-right ${disabled ? "opacity-40" : ""}`}
    />
  );
}

function Row({ line, on, amount, onToggle, onAmount }: {
  line: PlanLine; on: boolean; amount: number; onToggle: () => void; onAmount: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
      <input type="checkbox" checked={on} onChange={onToggle} aria-label={`Count ${line.label}`} />
      <div className={`min-w-0 flex-1 ${on ? "" : "opacity-50"}`}>
        <div className="text-sm truncate">{line.label}</div>
        <div className="text-[11px] text-text-muted truncate">
          {line.date && <>{shortDate(line.date)} · </>}{line.note}
        </div>
      </div>
      <AmountInput value={amount} onChange={onAmount} disabled={!on} />
    </div>
  );
}

function Section({ title, total, children, hint }: { title: string; total: number; children: React.ReactNode; hint?: string }) {
  return (
    <div className="mt-5 first:mt-0">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className="min-w-0 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{title}</div>
        <div className="shrink-0 whitespace-nowrap font-mono text-[13px] text-text-dim">−{fmt(total)}</div>
      </div>
      {hint && <div className="text-[11px] text-text-muted mb-1">{hint}</div>}
      {children}
    </div>
  );
}

/**
 * Scratchpad for the 16th: start from what the data suggests, adjust until the
 * number looks right, then use it as the month's budget. Every edit saves as you
 * go, so it can be picked up again later.
 */
export default function MidMonthPlan({ open, onClose, month, onUse, onToast }: {
  open: boolean;
  onClose: () => void;
  month: string;
  onUse: (amount: number) => Promise<void>;
  onToast: (msg: string, err?: boolean) => void;
}) {
  const [data, setData] = useState<PlanData | null>(null);
  const [failed, setFailed] = useState(false);
  const [plans, setPlans] = useState<Record<string, SavedPlan>>({});
  const [plan, setPlan] = useState<SavedPlan>(blankPlan());
  const [status, setStatus] = useState<"" | "saving" | "saved" | "error">("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fresh suggestions each time it opens: the data may have grown since last time
  useEffect(() => {
    if (!open) return;
    setData(null);
    setFailed(false);
    setStatus("");
    api.transactions.midmonth(month).then(setData).catch(() => setFailed(true));
    api.settings
      .get<Record<string, SavedPlan>>(PLANS_KEY)
      .then((res) => {
        const all = res.value || {};
        setPlans(all);
        setPlan({ ...blankPlan(), ...(all[month] ?? {}) });
      })
      .catch(() => setPlan(blankPlan()));
  }, [open, month]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  async function persist(next: SavedPlan, all = plans): Promise<boolean> {
    const saved = { ...all, [month]: { ...next, savedAt: new Date().toISOString() } };
    setStatus("saving");
    try {
      await api.settings.set(PLANS_KEY, saved);
      setPlans(saved);
      setStatus("saved");
      return true;
    } catch {
      setStatus("error");
      return false;
    }
  }

  // Every change saves shortly after you stop typing
  const edit = (fn: (p: SavedPlan) => SavedPlan) => {
    setPlan((p) => {
      const next = fn(p);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(next), 700);
      return next;
    });
  };
  const amountOf = (l: PlanLine) => plan.amounts[l.key] ?? l.amount;
  const isOn = (l: PlanLine, work = false) => (work ? plan.workOn.includes(l.key) : !plan.off.includes(l.key));
  const toggle = (l: PlanLine, work = false) =>
    edit((p) =>
      work
        ? { ...p, workOn: p.workOn.includes(l.key) ? p.workOn.filter((k) => k !== l.key) : [...p.workOn, l.key] }
        : { ...p, off: p.off.includes(l.key) ? p.off.filter((k) => k !== l.key) : [...p.off, l.key] }
    );
  const setAmount = (l: PlanLine, n: number) => edit((p) => ({ ...p, amounts: { ...p.amounts, [l.key]: n } }));
  const edited = Object.keys(plan.amounts).length + plan.off.length + plan.workOn.length + plan.extras.length > 0 || plan.reserve !== DEFAULT_RESERVE;

  const totals = useMemo(() => {
    if (!data) return null;
    const sum = (lines: PlanLine[], work = false) => lines.filter((l) => isOn(l, work)).reduce((s, l) => s + amountOf(l), 0);
    const bills = sum(data.bills);
    const pending = sum(data.pending);
    const work = sum(data.work, true);
    const extras = plan.extras.reduce((s, e) => s + (e.amount || 0), 0);
    const out = bills + pending + work + extras + (plan.reserve || 0);
    return { bills, pending, work, extras, out, available: plan.ally == null ? null : plan.ally - out };
  }, [data, plan]);

  const windowLabel = data ? `${MONTHS[Number(month.slice(5, 7)) - 1]} 16–${Number(data.window.end.slice(8, 10))}` : "";
  const available = totals?.available ?? null;

  const footer = (
    <>
      <div className="mr-auto min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Available</div>
        <div className={`font-mono text-[22px] leading-tight font-semibold ${available == null ? "text-text-muted" : available >= 0 ? "text-green" : "text-red"}`}>
          {available == null ? "—" : `${available < 0 ? "−" : ""}${fmt(Math.abs(available))}`}
        </div>
        <div className="text-[11px] text-text-dim truncate">
          {available == null
            ? totals ? `Enter the balance · ${fmt(totals.out)} set aside` : ""
            : available >= CUSHION
              ? `${fmt(available - CUSHION)} beyond your ${fmt(CUSHION)} cushion`
              : `${fmt(CUSHION - Math.max(available, 0))} short of your ${fmt(CUSHION)} cushion`}
        </div>
      </div>
      <button
        className="btn btn-primary"
        onClick={async () => {
          if (available == null || available <= 0) {
            onToast(available == null ? "Enter the Ally balance first" : "Nothing available to budget", true);
            return;
          }
          if (saveTimer.current) clearTimeout(saveTimer.current);
          if (!(await persist(plan))) return onToast("Couldn't save the plan", true);
          await onUse(Math.round(available * 100) / 100);
          onClose();
        }}
      >
        Use as budget
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Plan the 16th"
      titleExtra={<span className="text-[13px] font-normal text-text-muted">{windowLabel || moLabel(month)}</span>}
      footer={footer}
      className="!w-[640px]"
    >
      {failed && <div className="text-[13px] text-text-dim py-4">Couldn't load your statement data. You're probably offline.</div>}
      {!data && !failed && <div className="text-[13px] text-text-dim py-4">Loading…</div>}

      {data && totals && (
        <div className="pb-2">
          {!data.dataComplete && (
            <div className="mb-4 rounded-lg bg-amber-dim border border-amber/20 px-3.5 py-2.5 text-[12px] text-amber">
              Your statements run through {fmtDate(data.asOf)}. Upload them through the 15th for a tighter pending estimate.
            </div>
          )}

          <div className="flex items-end justify-between gap-3 mb-5 flex-wrap">
            <div className="input-group w-[220px] max-w-full">
              <label htmlFor="ally-balance">Ally checking on the 15th</label>
              <input
                id="ally-balance"
                type="number"
                step="0.01"
                inputMode="decimal"
                placeholder="Balance after the paycheck"
                value={plan.ally ?? ""}
                onChange={(e) => edit((p) => ({ ...p, ally: e.target.value === "" ? null : parseFloat(e.target.value) }))}
                className="font-mono"
              />
            </div>
            <div className="text-[11px] text-text-muted text-right max-md:text-left">
              {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? <span className="text-red">Couldn't save</span> : plans[month]?.savedAt ? `Last saved ${localDay(plans[month].savedAt!)}` : "Changes save as you go"}
              {edited && (
                <button
                  type="button"
                  className="block ml-auto max-md:ml-0 mt-1 text-accent"
                  onClick={() => edit((p) => ({ ...blankPlan(), ally: p.ally }))}
                >
                  Reset to suggestions
                </button>
              )}
            </div>
          </div>

          <Section title={`Bills due ${windowLabel}`} total={totals.bills} hint="Projected amounts. Shared bills count in full, since the full charge leaves checking.">
            {data.bills.length === 0 && <div className="text-[13px] text-text-dim py-2">No bills due in the second half.</div>}
            {data.bills.map((l) => (
              <Row key={l.key} line={l} on={isOn(l)} amount={amountOf(l)} onToggle={() => toggle(l)} onAmount={(n) => setAmount(l, n)} />
            ))}
          </Section>

          <Section title="Pending from the first half" total={totals.pending} hint="Charges through the 15th that haven't left checking yet. Cards are paid as charges post.">
            {data.pending.length === 0 && <div className="text-[13px] text-text-dim py-2">Nothing pending.</div>}
            {data.pending.map((l) => (
              <Row key={l.key} line={l} on={isOn(l)} amount={amountOf(l)} onToggle={() => toggle(l)} onAmount={(n) => setAmount(l, n)} />
            ))}
          </Section>

          <Section title="Extra principal" total={plan.reserve || 0}>
            <div className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm">Pennymac extra payment</div>
                <div className="text-[11px] text-text-muted">Set aside first; counts as savings</div>
              </div>
              <AmountInput value={plan.reserve} onChange={(n) => edit((p) => ({ ...p, reserve: n }))} />
            </div>
          </Section>

          {data.work.length > 0 && (
            <Section title="Work expenses" total={totals.work} hint="Likely to charge in the window. Left out by default: reimbursed on the 1st. Tick one to hold it back anyway.">
              {data.work.map((l) => (
                <Row key={l.key} line={l} on={isOn(l, true)} amount={amountOf(l)} onToggle={() => toggle(l, true)} onAmount={(n) => setAmount(l, n)} />
              ))}
            </Section>
          )}

          <Section title="Other" total={totals.extras}>
            {plan.extras.map((x) => (
              <div key={x.id} className="flex items-center gap-3 py-2 border-b border-border/30">
                <input
                  type="text"
                  value={x.label}
                  placeholder="What for?"
                  onChange={(e) => edit((p) => ({ ...p, extras: p.extras.map((y) => (y.id === x.id ? { ...y, label: e.target.value } : y)) }))}
                  className="!py-1.5 !px-2.5 !text-sm flex-1 min-w-0"
                />
                <AmountInput value={x.amount} onChange={(n) => edit((p) => ({ ...p, extras: p.extras.map((y) => (y.id === x.id ? { ...y, amount: n } : y)) }))} />
                <button
                  type="button"
                  aria-label="Remove"
                  className="text-text-muted hover:text-red text-sm px-1"
                  onClick={() => edit((p) => ({ ...p, extras: p.extras.filter((y) => y.id !== x.id) }))}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-[12px] text-accent mt-2"
              onClick={() => edit((p) => ({ ...p, extras: [...p.extras, { id: Date.now().toString(36), label: "", amount: 0 }] }))}
            >
              + Add a planned expense
            </button>
          </Section>
        </div>
      )}
    </Modal>
  );
}
