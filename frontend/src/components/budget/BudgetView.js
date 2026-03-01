import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../lib/api";
import { fmt, fmtP, fmtDate, curMo, moLabel, today } from "../../lib/formatters";
import Modal from "../layout/Modal";
export default function BudgetView({ onToast, onDataChange }) {
    const [selectedMonth, setSelectedMonth] = useState(curMo());
    const [expenses, setExpenses] = useState([]);
    const [allMonths, setAllMonths] = useState([]);
    const [budgetTargets, setBudgetTargets] = useState({});
    const [justAdded, setJustAdded] = useState(null);
    // Quick add state
    const [qaDesc, setQaDesc] = useState("");
    const [qaAmt, setQaAmt] = useState("");
    const descRef = useRef(null);
    const amtRef = useRef(null);
    // Budget target modal
    const [targetOpen, setTargetOpen] = useState(false);
    const [targetAmt, setTargetAmt] = useState("");
    const loadExpenses = useCallback(() => {
        api.expenses.list(selectedMonth).then(setExpenses).catch(() => { });
    }, [selectedMonth]);
    const loadMonths = useCallback(() => {
        api.expenses.months().then((months) => {
            const set = new Set([curMo(), ...months]);
            Object.keys(budgetTargets).forEach((m) => set.add(m));
            setAllMonths([...set].sort().reverse());
        }).catch(() => { });
    }, [budgetTargets]);
    const loadTargets = useCallback(() => {
        api.settings.get("budgetTargets").then((res) => {
            setBudgetTargets(res.value || {});
        }).catch(() => { });
    }, []);
    useEffect(() => { loadTargets(); }, [loadTargets]);
    useEffect(() => { loadExpenses(); }, [loadExpenses]);
    useEffect(() => { loadMonths(); }, [loadMonths]);
    // Clear flash animation
    useEffect(() => {
        if (!justAdded)
            return;
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
                setTimeout(() => { if (descRef.current)
                    descRef.current.style.borderColor = ""; }, 1500);
            }
            return;
        }
        if (!amount || isNaN(amount) || amount <= 0) {
            if (amtRef.current) {
                amtRef.current.style.borderColor = "var(--red)";
                amtRef.current.focus();
                setTimeout(() => { if (amtRef.current)
                    amtRef.current.style.borderColor = ""; }, 1500);
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
            }
            else {
                loadExpenses();
            }
            loadMonths();
            onDataChange?.();
            descRef.current?.focus();
            onToast("Expense added");
        }
        catch {
            onToast("Error adding expense", true);
        }
    }
    async function deleteExpense(id) {
        try {
            await api.expenses.delete(id);
            loadExpenses();
            onDataChange?.();
            onToast("Deleted");
        }
        catch {
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
        }
        catch {
            onToast("Failed to save", true);
        }
    }
    function handleKeyDown(e) {
        if (e.key === "Enter") {
            e.preventDefault();
            quickAdd();
        }
    }
    return (_jsxs("div", { children: [_jsx("div", { className: "bg-bg-card border-[1.5px] border-accent rounded-xl p-5 mb-5", children: _jsxs("div", { className: "flex gap-2.5 items-end max-md:flex-wrap", children: [_jsx("div", { className: "input-group flex-[2]", children: _jsx("input", { ref: descRef, type: "text", placeholder: "What was it?", value: qaDesc, onChange: (e) => setQaDesc(e.target.value), onKeyDown: handleKeyDown, className: "!text-base !py-3 !px-3.5", autoComplete: "off" }) }), _jsx("div", { className: "input-group flex-1 max-w-[140px]", children: _jsx("input", { ref: amtRef, type: "number", step: "0.01", placeholder: "0.00", inputMode: "decimal", value: qaAmt, onChange: (e) => setQaAmt(e.target.value), onKeyDown: handleKeyDown, className: "!py-3 !px-3.5" }) }), _jsx("button", { className: "btn btn-primary h-12 px-6 text-[15px] flex-shrink-0 max-md:w-full max-md:h-12", onClick: quickAdd, children: "Add" })] }) }), _jsxs("div", { className: "flex items-center gap-2.5 mb-5", children: [_jsx("select", { value: selectedMonth, onChange: (e) => setSelectedMonth(e.target.value), className: "!w-auto !text-sm !py-1.5 !px-3", children: allMonths.map((m) => (_jsx("option", { value: m, children: moLabel(m) }, m))) }), _jsx("button", { className: "btn btn-sm", onClick: () => {
                            setTargetAmt(String(budgetTargets[selectedMonth] || ""));
                            setTargetOpen(true);
                        }, children: "Set Target" })] }), _jsx("div", { className: "bg-bg-card border border-border rounded-xl p-6 mb-5", children: target > 0 ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "text-center pb-4", children: [_jsx("div", { className: "font-mono text-[44px] font-semibold tracking-tight", style: { color: remaining >= 0 ? "var(--green)" : "var(--red)" }, children: fmt(remaining) }), _jsx("div", { className: "text-[13px] text-text-muted mt-1", children: "remaining this month" })] }), _jsx("div", { className: "bg-bg-input rounded-lg h-5 overflow-hidden mb-2.5", children: _jsx("div", { className: `h-full rounded-lg transition-[width] duration-500 ${pct > 90
                                    ? "bg-gradient-to-r from-red to-[#ef4444]"
                                    : pct > 70
                                        ? "bg-gradient-to-r from-amber to-[#f59e0b]"
                                        : "bg-gradient-to-r from-green to-cyan"}`, style: { width: `${Math.min(pct, 100)}%` } }) }), _jsxs("div", { className: "flex justify-between", children: [_jsxs("span", { className: "text-xs text-text-muted", children: ["Spent: ", _jsx("span", { className: "font-mono", children: fmt(spent) })] }), _jsxs("span", { className: "text-xs text-text-muted", children: ["Target: ", _jsx("span", { className: "font-mono", children: fmt(target) })] })] })] })) : (_jsxs("div", { className: "text-center py-5", children: [_jsx("div", { className: "font-mono text-[28px] font-semibold text-text-dim", children: fmt(spent) }), _jsx("div", { className: "text-[13px] text-text-muted mt-1", children: "spent this month" })] })) }), _jsxs("div", { className: "bg-bg-card border border-border rounded-xl p-6", children: [_jsx("div", { className: "text-[14px] font-semibold uppercase tracking-wider text-text-dim mb-5", children: "Expenses" }), expenses.length === 0 ? (_jsxs("div", { className: "text-center py-12 text-text-dim", children: [_jsx("div", { className: "text-4xl mb-3 opacity-40", children: "\uD83D\uDCDD" }), _jsx("p", { className: "text-sm", children: "No expenses this month" })] })) : (expenses
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .map((e) => (_jsxs("div", { className: `flex items-center justify-between py-3.5 px-4 my-1 rounded-[10px] gap-3 transition-colors hover:bg-white/[0.03] ${justAdded === e.id
                            ? "animate-[flashGreen_1.8s_ease-out] bg-green/[0.13] shadow-[0_0_0_1px_rgba(52,211,153,0.25)]"
                            : ""}`, children: [_jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("div", { className: "text-sm font-medium truncate", children: e.description }), _jsx("div", { className: "text-xs text-text-muted mt-0.5", children: fmtDate(e.date) })] }), _jsx("span", { className: "font-mono text-sm font-medium flex-shrink-0", children: fmtP(e.amount) }), _jsx("button", { className: "bg-transparent border-none cursor-pointer text-[13px] p-1.5 px-2 rounded-md opacity-30 hover:opacity-100 hover:text-red hover:bg-red-dim transition-all flex-shrink-0 text-text-muted", onClick: () => deleteExpense(e.id), title: "Delete", children: "\u2715" })] }, e.id))))] }), _jsxs(Modal, { open: targetOpen, onClose: () => setTargetOpen(false), title: "Set Budget Target", children: [_jsxs("p", { className: "text-[13px] text-text-dim mb-5", children: ["Set your spending target for ", moLabel(selectedMonth), "."] }), _jsxs("div", { className: "grid grid-cols-2 max-md:grid-cols-1 gap-3", children: [_jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Month" }), _jsx("input", { type: "text", value: moLabel(selectedMonth), disabled: true })] }), _jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Target Amount" }), _jsx("input", { type: "number", step: "0.01", placeholder: "0.00", value: targetAmt, onChange: (e) => setTargetAmt(e.target.value), onKeyDown: (e) => {
                                            if (e.key === "Enter")
                                                saveTarget();
                                        } })] })] }), _jsxs("div", { className: "flex justify-end gap-2.5 mt-4 pt-4 border-t border-border", children: [_jsx("button", { className: "btn", onClick: () => setTargetOpen(false), children: "Cancel" }), _jsx("button", { className: "btn btn-primary", onClick: saveTarget, children: "Save" })] })] })] }));
}
