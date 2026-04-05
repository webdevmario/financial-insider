import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../lib/api";
import { fmt, fmtP, fmtDate, curMo, moLabel, today } from "../../lib/formatters";
import Modal from "../layout/Modal";
import type { Expense } from "../../types";

interface BudgetViewProps {
  onToast: (msg: string, err?: boolean) => void;
  onDataChange?: () => void;
}

export default function BudgetView({ onToast }: BudgetViewProps) {
  const [loading, setLoading] = useState(true);
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

  // Edit expense modal
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [editAmt, setEditAmt] = useState("");
  const [editDate, setEditDate] = useState("");

  // Monthly notes
  const [budgetNotes, setBudgetNotes] = useState<Record<string, string>>({});
  const [noteText, setNoteText] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [notesIndexOpen, setNotesIndexOpen] = useState(false);
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadExpenses = useCallback(() => {
    return api.expenses.list(selectedMonth).then(setExpenses).catch(() => {});
  }, [selectedMonth]);

  const loadMonths = useCallback(() => {
    return api.expenses.months().then((months) => {
      const set = new Set([curMo(), selectedMonth, ...months]);
      Object.keys(budgetTargets).forEach((m) => set.add(m));
      setAllMonths([...set].sort().reverse());
    }).catch(() => {});
  }, [budgetTargets, selectedMonth]);

  const loadTargets = useCallback(() => {
    return api.settings.get<Record<string, number>>("budgetTargets").then((res) => {
      setBudgetTargets(res.value || {});
    }).catch(() => {});
  }, []);

  const loadNotes = useCallback(() => {
    return api.settings.get<Record<string, string>>("budgetNotes").then((res) => {
      setBudgetNotes(res.value || {});
    }).catch(() => {});
  }, []);

  useEffect(() => { loadTargets(); loadNotes(); }, [loadTargets, loadNotes]);

  // Sync noteText when month or notes data changes
  useEffect(() => {
    setNoteText(budgetNotes[selectedMonth] || "");
    setNoteOpen(!!budgetNotes[selectedMonth]);
  }, [selectedMonth, budgetNotes]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadExpenses(), loadMonths()]).finally(() => setLoading(false));
  }, [loadExpenses, loadMonths]);

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

  function capitalize(str: string): string {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  async function quickAdd() {
    const desc = qaDesc.trim().toUpperCase();
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
      // Use selected month, not necessarily today
      const todayStr = today();
      const todayMonth = todayStr.slice(0, 7);

      let date: string;

      if (selectedMonth === todayMonth) {
        // Current month: use today's date
        date = todayStr;
      } else {
        // Historical month: use the last day of that month
        const [y, m] = selectedMonth.split("-").map(Number);
        const lastDay = new Date(y, m, 0).getDate();

        date = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;
      }

      const created = await api.expenses.create({
        date,
        month: selectedMonth,
        description: desc,
        category: "General",
        amount,
      });

      setQaDesc("");
      setQaAmt("");
      setJustAdded(created.id);

      loadExpenses();
      loadMonths();

      // dismiss mobile keyboard
      amtRef.current?.blur();

      // Reliable refocus to description field (really only for desktop)
      // setTimeout(() => {
      //   descRef.current?.focus();
      // }, 50);

      onToast("Expense added");
    } catch {
      onToast("Error adding expense", true);
    }
  }

  async function deleteExpense(id: string) {
    try {
      await api.expenses.delete(id);
      loadExpenses();
      onToast("Deleted");
    } catch {
      onToast("Failed to delete", true);
    }
  }

  function openEditExpense(e: Expense) {
    setEditingExpense(e);
    setEditDesc(e.description);
    setEditAmt(String(e.amount));
    setEditDate(e.date);
  }

  async function saveEditExpense() {
    if (!editingExpense) return;
    const desc = editDesc.trim().toUpperCase();
    const amount = parseFloat(editAmt);

    if (!desc) { onToast("Enter description", true); return; }
    if (!amount || isNaN(amount) || amount <= 0) { onToast("Enter amount", true); return; }

    try {
      // Delete old and create new (expenses API doesn't have PUT)
      await api.expenses.delete(editingExpense.id);
      await api.expenses.create({
        date: editDate,
        month: editDate.slice(0, 7),
        description: desc,
        category: editingExpense.category,
        amount,
      });

      setEditingExpense(null);
      loadExpenses();
      loadMonths();
      onToast("Updated");
    } catch {
      onToast("Failed to update", true);
    }
  }

  async function deleteFromEdit() {
    if (!editingExpense) return;
    await deleteExpense(editingExpense.id);
    setEditingExpense(null);
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

  function saveNote(text: string) {
    const trimmed = text.trim();
    const updated = { ...budgetNotes };
    if (trimmed) {
      updated[selectedMonth] = trimmed;
    } else {
      delete updated[selectedMonth];
    }
    setBudgetNotes(updated);
    api.settings.set("budgetNotes", updated).catch(() => {
      onToast("Failed to save note", true);
    });
  }

  function onNoteChange(text: string) {
    setNoteText(text);
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => saveNote(text), 1000);
  }

  const monthsWithNotes = Object.keys(budgetNotes).sort().reverse();

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      quickAdd();
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="w-7 h-7 border-2 border-border border-t-accent rounded-full animate-spin" />
        <span className="text-sm text-text-muted">Loading…</span>
      </div>
    );
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
              autoCapitalize="sentences"
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
        {/* Show which month expenses go to */}
        {selectedMonth !== curMo() && (
          <div className="text-[11px] text-amber mt-2 font-medium">
            Adding to {moLabel(selectedMonth)}
          </div>
        )}
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

      {/* Monthly Note */}
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <button
            className="flex items-center gap-2 text-xs text-text-muted hover:text-text transition-colors"
            onClick={() => setNoteOpen(!noteOpen)}
          >
            <span
              className="transition-transform duration-150"
              style={{ display: "inline-block", transform: noteOpen ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              ›
            </span>
            <span>{budgetNotes[selectedMonth] ? "Note" : "Add note"}</span>
          </button>
          {monthsWithNotes.length > 0 && (
            <button
              className="text-xs text-text-muted hover:text-accent transition-colors"
              onClick={() => setNotesIndexOpen(!notesIndexOpen)}
            >
              {monthsWithNotes.length} note{monthsWithNotes.length !== 1 ? "s" : ""} total
            </button>
          )}
        </div>

        {/* Note editor for current month */}
        {noteOpen && (
          <div className="mt-2">
            <textarea
              className="w-full bg-bg-card border border-border rounded-lg p-3 text-sm text-text resize-none focus:outline-none focus:border-accent transition-colors"
              rows={3}
              placeholder={`Notes for ${moLabel(selectedMonth)}...`}
              value={noteText}
              onChange={(e) => onNoteChange(e.target.value)}
              onBlur={() => {
                if (noteSaveTimer.current) {
                  clearTimeout(noteSaveTimer.current);
                  noteSaveTimer.current = null;
                }
                saveNote(noteText);
              }}
            />
          </div>
        )}

        {/* Notes index — all months with notes */}
        {notesIndexOpen && monthsWithNotes.length > 0 && (
          <div className="mt-2 bg-bg-card border border-border rounded-xl p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-text-dim mb-3">
              All Notes
            </div>
            <div className="flex flex-col gap-1.5">
              {monthsWithNotes.map((m) => (
                <button
                  key={m}
                  className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    m === selectedMonth
                      ? "bg-accent/10 text-accent"
                      : "hover:bg-white/[0.04] text-text"
                  }`}
                  onClick={() => {
                    setSelectedMonth(m);
                    setNotesIndexOpen(false);
                    setNoteOpen(true);
                  }}
                >
                  <div className="font-medium">{moLabel(m)}</div>
                  <div className="text-xs text-text-muted mt-0.5 truncate">
                    {budgetNotes[m]}
                  </div>
                </button>
              ))}
            </div>
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
            .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
            .map((e) => (
              <div
                key={e.id}
                className={`flex items-center justify-between py-3.5 px-4 my-1 rounded-[10px] gap-3 transition-colors hover:bg-white/[0.03] cursor-pointer ${
                  justAdded === e.id
                    ? "animate-[flashGreen_1.8s_ease-out] bg-green/[0.13] shadow-[0_0_0_1px_rgba(52,211,153,0.25)]"
                    : ""
                }`}
                onClick={() => openEditExpense(e)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{e.description}</div>
                  <div className="text-xs text-text-muted mt-0.5">{fmtDate(e.date)}</div>
                </div>
                <span className="font-mono text-sm font-medium flex-shrink-0">
                  {fmtP(e.amount)}
                </span>
                <span className="text-text-muted text-lg opacity-60">›</span>
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

      {/* Edit Expense Modal */}
      <Modal
        open={!!editingExpense}
        onClose={() => setEditingExpense(null)}
        title="Edit Expense"
      >
        <div className="flex flex-col gap-4">
          <div className="input-group">
            <label>Description</label>
            <input
              type="text"
              value={editDesc}
              onChange={(e) => setEditDesc(capitalize(e.target.value))}
              autoCapitalize="sentences"
            />
          </div>
          <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
            <div className="input-group">
              <label>Amount</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={editAmt}
                onChange={(e) => setEditAmt(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>Date</label>
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2.5 pt-4 border-t border-border max-md:pb-[env(safe-area-inset-bottom)]">
            <button className="btn btn-danger btn-sm" onClick={deleteFromEdit}>
              🗑️ Delete
            </button>
            <button className="btn" onClick={() => setEditingExpense(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveEditExpense}>Update</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}