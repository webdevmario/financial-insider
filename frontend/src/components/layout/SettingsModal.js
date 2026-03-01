import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import Modal from "../layout/Modal";
import { api } from "../../lib/api";
import { fmt, fmtP, fmtDate } from "../../lib/formatters";
export default function SettingsModal({ open, onClose, onToast, onDataChange }) {
    const [paycheck, setPaycheck] = useState("");
    const [originalPaycheck, setOriginalPaycheck] = useState(0);
    const [paycheckHistory, setPaycheckHistory] = useState([]);
    const [showDanger, setShowDanger] = useState(false);
    useEffect(() => {
        if (!open)
            return;
        api.settings.getAll().then((s) => {
            const pc = s.paycheck || 0;
            setPaycheck(pc ? String(pc) : "");
            setOriginalPaycheck(pc);
            setPaycheckHistory(s.paycheckHistory || []);
        }).catch(() => { });
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
        }
        catch {
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
        }
        catch {
            onToast("Export failed", true);
        }
    }
    function importJSON() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                await api.data.import(data);
                onDataChange();
                onToast("Imported");
            }
            catch {
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
        }
        catch {
            onToast("Failed to delete", true);
        }
    }
    return (_jsxs(Modal, { open: open, onClose: onClose, title: "Settings", children: [_jsxs("div", { className: "py-5 border-b border-border", children: [_jsx("h3", { className: "text-[13px] font-semibold uppercase tracking-wider text-text-dim mb-4", children: "Income" }), _jsxs("div", { className: "flex gap-2.5 items-end mb-2", children: [_jsxs("div", { className: "input-group flex-1", children: [_jsx("label", { children: "Per-Paycheck (after tax)" }), _jsx("input", { type: "number", step: "0.01", placeholder: "0.00", value: paycheck, onChange: (e) => setPaycheck(e.target.value) })] }), _jsx("button", { className: "btn btn-primary btn-sm", onClick: saveIncome, children: "Update" })] }), _jsxs("div", { className: "text-[13px] text-text-dim mb-3", children: ["Semi-monthly (\u00D72) = ", _jsx("span", { className: "font-mono", children: fmt(pp * 2) }), "/mo"] }), _jsxs("details", { className: "cursor-pointer", children: [_jsx("summary", { className: "text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2", children: "Pay History" }), _jsx("div", { className: "max-h-[150px] overflow-y-auto", children: paycheckHistory.length === 0 ? (_jsx("p", { className: "text-xs text-text-muted py-2", children: "No changes yet" })) : ([...paycheckHistory].reverse().map((h, i) => (_jsxs("div", { className: "flex justify-between py-1.5 border-b border-border/30 text-xs", children: [_jsx("span", { className: "text-text-muted", children: fmtDate(h.date) }), _jsxs("span", { className: "font-mono text-text-dim", children: [fmtP(h.amount), " \u2192 ", fmtP(h.amount * 2), "/mo"] })] }, i)))) })] })] }), _jsxs("div", { className: "py-5 border-b border-border", children: [_jsx("h3", { className: "text-[13px] font-semibold uppercase tracking-wider text-text-dim mb-4", children: "Data" }), _jsxs("div", { className: "flex items-center justify-between gap-4 mb-3 max-md:flex-col max-md:items-stretch", children: [_jsx("p", { className: "text-[13px] text-text-muted", children: "JSON backup" }), _jsx("button", { className: "btn max-md:self-start", onClick: exportJSON, children: "\uD83D\uDCE4 Export" })] }), _jsxs("div", { className: "flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch", children: [_jsx("p", { className: "text-[13px] text-text-muted", children: "Restore from backup" }), _jsx("button", { className: "btn max-md:self-start", onClick: importJSON, children: "\uD83D\uDCE5 Import" })] })] }), _jsxs("div", { className: "py-5", children: [_jsx("h3", { className: "text-[13px] font-semibold uppercase tracking-wider text-text-dim mb-4", children: "Danger Zone" }), !showDanger ? (_jsxs("div", { className: "flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch", children: [_jsx("p", { className: "text-[13px] text-red", children: "Permanently delete all data. Cannot be undone." }), _jsx("button", { className: "btn btn-danger max-md:self-start", onClick: () => setShowDanger(true), children: "\uD83D\uDDD1\uFE0F Delete All" })] })) : (_jsxs("div", { className: "bg-red-dim border border-red/30 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-text mb-3", children: "Are you sure? This cannot be undone." }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { className: "btn btn-sm", onClick: () => setShowDanger(false), children: "Cancel" }), _jsx("button", { className: "btn btn-danger btn-sm", onClick: deleteAll, children: "Yes, delete everything" })] })] }))] })] }));
}
