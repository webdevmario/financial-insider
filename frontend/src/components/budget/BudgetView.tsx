import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../lib/api";
import { fmt, fmtP, fmtDate, curMo, moLabel, today } from "../../lib/formatters";
import Modal from "../layout/Modal";
import type { Expense } from "../../types";

interface BudgetViewProps {
  onToast: (msg: string, err?: boolean) => void;
  onDataChange?: () => void;
}

export default function BudgetView({ onToast, onDataChange }: BudgetViewProps) {
  const [selectedMonth, setSelectedMonth] = useState(curMo());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [budgetTargets, setBudgetTargets] = useState<Record<string, number>>({});
  const [justAdded, setJustAdded] = useState<string | null>(null);

  // Quick add state
  const [qaDesc, setQaDesc] = useState("");
  const [qaAmt, setQaAmt] = useState("");
  const descRef = useRef<HTMLInputElement>(null);
  const amtRef = useRef<HTMLInputElement>(null);

  // Budget target modal
  const [targetOpen, setTargetOpen] = useState(false);
  const [targetAmt, setTargetAmt] = useState("");

  const loadExpenses = useCallback(() => {
    api.expenses.list(selectedMonth).then(setExpenses).catch(() => {});
  }, [selectedMonth]);

  const loadMonths = useCallback(() => {
    api.expenses.months().then((months) => {
      const set = new Set([curMo(), ...months]);
      Object.keys(budgetTargets).forEach((m) => set.add(m));
      setAllMonths([...set].sort().reverse());
    }).catch(() => {});
  }, [budgetTargets]);

  const loadTargets = useCallback(() => {
    api.settings.get<Record<string, number>>("budgetTargets").then((res) => {
      setBudgetTargets(res.value || {});
    }).catch(() => {});
  }, []);

  useEffect(() => { loadTargets(); }, [loadTargets]);
  useEffect(() => { loadExpenses(); }, [loadExpenses]);
  useEffect(() => { loadMonths(); }, [loadMonths]);

  // Clear flash animation
  useEffect(() => {
    if (!justAdded) return;
    const t = setTimeout(() => setJustAdded(null), 2000);
    return () => clearTimeout(t);
  }, [justAdded]);

  const target = budgetTargets[selectedMonth] || 0;
  const spent = expenses.reduce((s, e) => s + e.amount, 0);
  const remaining = target - spent;
  const pct = target > 0 ? (spent / target) * 100 : 0;

  async function quickAdd() {
    const desc = qaDesc.trim();
    const amount = parseFloat(qaAmt);

    if (!desc) {
      if (descRef.current) {
        descRef.current.style.borderColor = "var(--red)";
        descRef.current.focus();
        setTimeout(() => { if (descRef.current) descRef.current.style.borderColor = ""; }, 1500);
      }
      return;
    }
    if (!amount || isNaN(amount) || amount <= 0) {
      if (amtRef.current) {
        amtRef.current.style.borderColor = "var(--red)";
        amtRef.current.focus();
        setTimeout(() => { if (amtRef.current) amtRef.current.style.borderColor = ""; }, 1500);
      }
      return;
    }

    try {
      const todayStr = today();
      const month = todayStr.slice(0, 7);
      const created = await api.expenses.create({
        date: todayStr,
        month,
        description: desc,
        category: "General",
        amount,
      });

      setQaDesc("");
      setQaAmt("");
      setJustAdded(created.id);

      // Switch to expense's month if different
      if (selectedMonth !== month) {
        setSelectedMonth(month);
      } else {
        loadExpenses();
      }
      loadMonths();
      onDataChange?.();
      descRef.current?.focus();
      onToast("Expense added");
    } catch {
      onToast("Error adding expense", true);
    }
  }

  async function deleteExpense(id: string) {
    try {
      await api.expenses.delete(id);
      loadExpenses();
      onDataChange?.();
      onToast("Deleted");
    } catch {
      onToast("Failed to delete", true);
    }
  }

  async function saveTarget() {
    const newTargets = { ...budgetTargets, [selectedMonth]: parseFloat(targetAmt) || 0 };
    try {
      await api.settings.set("budgetTargets", newTargets);
      setBudgetTargets(newTargets);
      setTargetOpen(false);
      onToast("Target saved");
    } catch {
      onToast("Failed to save", true);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      quickAdd();
    }
  }

  return (
    <div>
      {/* Quick Add */}
      <div className="bg-bg-card border-[1.5px] border-accent rounded-xl p-5 mb-5">
        <div className="flex gap-2.5 items-end max-md:flex-wrap">
          <div className="input-group flex-[2]">
            <input
              ref={descRef}
              type="text"
              placeholder="What was it?"
              value={qaDesc}
              onChange={(e) => setQaDesc(e.target.value)}
              onKeyDown={handleKeyDown}
              className="!text-base !py-3 !px-3.5"
              autoComplete="off"
            />
          </div>
          <div className="input-group flex-1 max-w-[140px]">
            <input
              ref={amtRef}
              type="number"
              step="0.01"
              placeholder="0.00"
              inputMode="decimal"
              value={qaAmt}
              onChange={(e) => setQaAmt(e.target.value)}
              onKeyDown={handleKeyDown}
              className="!py-3 !px-3.5"
            />
          </div>
          <button
            className="btn btn-primary h-12 px-6 text-[15px] flex-shrink-0 max-md:w-full max-md:h-12"
            onClick={quickAdd}
          >
            Add
          </button>
        </div>
      </div>

      {/* Month selector + target button */}
      <div className="flex items-center gap-2.5 mb-5">
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="!w-auto !text-sm !py-1.5 !px-3"
        >
          {allMonths.map((m) => (
            <option key={m} value={m}>{moLabel(m)}</option>
          ))}
        </select>
        <button
          className="btn btn-sm"
          onClick={() => {
            setTargetAmt(String(budgetTargets[selectedMonth] || ""));
            setTargetOpen(true);
          }}
        >
          Set Target
        </button>
      </div>

      {/* Budget Summary */}
      <div className="bg-bg-card border border-border rounded-xl p-6 mb-5">
        {target > 0 ? (
          <>
            <div className="text-center pb-4">
              <div
                className="font-mono text-[44px] font-semibold tracking-tight"
                style={{ color: remaining >= 0 ? "var(--green)" : "var(--red)" }}
              >
                {fmt(remaining)}
              </div>
              <div className="text-[13px] text-text-muted mt-1">remaining this month</div>
            </div>
            <div className="bg-bg-input rounded-lg h-5 overflow-hidden mb-2.5">
              <div
                className={`h-full rounded-lg transition-[width] duration-500 ${
                  pct > 90
                    ? "bg-gradient-to-r from-red to-[#ef4444]"
                    : pct > 70
                      ? "bg-gradient-to-r from-amber to-[#f59e0b]"
                      : "bg-gradient-to-r from-green to-cyan"
                }`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-text-muted">
                Spent: <span className="font-mono">{fmt(spent)}</span>
              </span>
              <span className="text-xs text-text-muted">
                Target: <span className="font-mono">{fmt(target)}</span>
              </span>
            </div>
          </>
        ) : (
          <div className="text-center py-5">
            <div className="font-mono text-[28px] font-semibold text-text-dim">{fmt(spent)}</div>
            <div className="text-[13px] text-text-muted mt-1">spent this month</div>
          </div>
        )}
      </div>

      {/* Expenses Card */}
      <div className="bg-bg-card border border-border rounded-xl p-6">
        <div className="text-[14px] font-semibold uppercase tracking-wider text-text-dim mb-5">
          Expenses
        </div>

        {expenses.length === 0 ? (
          <div className="text-center py-12 text-text-dim">
            <div className="text-4xl mb-3 opacity-40">📝</div>
            <p className="text-sm">No expenses this month</p>
          </div>
        ) : (
          expenses
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((e) => (
              <div
                key={e.id}
                className={`flex items-center justify-between py-3.5 px-4 my-1 rounded-[10px] gap-3 transition-colors hover:bg-white/[0.03] ${
                  justAdded === e.id
                    ? "animate-[flashGreen_1.8s_ease-out] bg-green/[0.13] shadow-[0_0_0_1px_rgba(52,211,153,0.25)]"
                    : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{e.description}</div>
                  <div className="text-xs text-text-muted mt-0.5">{fmtDate(e.date)}</div>
                </div>
                <span className="font-mono text-sm font-medium flex-shrink-0">
                  {fmtP(e.amount)}
                </span>
                <button
                  className="bg-transparent border-none cursor-pointer text-[13px] p-1.5 px-2 rounded-md opacity-30 hover:opacity-100 hover:text-red hover:bg-red-dim transition-all flex-shrink-0 text-text-muted"
                  onClick={() => deleteExpense(e.id)}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            ))
        )}
      </div>

      {/* Budget Target Modal */}
      <Modal
        open={targetOpen}
        onClose={() => setTargetOpen(false)}
        title="Set Budget Target"
      >
        <p className="text-[13px] text-text-dim mb-5">
          Set your spending target for {moLabel(selectedMonth)}.
        </p>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <div className="input-group">
            <label>Month</label>
            <input type="text" value={moLabel(selectedMonth)} disabled />
          </div>
          <div className="input-group">
            <label>Target Amount</label>
            <input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={targetAmt}
              onChange={(e) => setTargetAmt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTarget();
              }}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2.5 mt-4 pt-4 border-t border-border">
          <button className="btn" onClick={() => setTargetOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveTarget}>Save</button>
        </div>
      </Modal>
    </div>
  );
}
