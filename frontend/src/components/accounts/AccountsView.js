import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { fmt, fmtDate } from "../../lib/formatters";
import AccountForm from "./AccountForm";
import { ACCT_ICONS } from "../../types";
export default function AccountsView({ onToast }) {
    const [accounts, setAccounts] = useState([]);
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const load = useCallback(() => {
        api.accounts.list().then(setAccounts).catch(() => { });
    }, []);
    useEffect(() => { load(); }, [load]);
    function openNew() {
        setEditing(null);
        setFormOpen(true);
    }
    function openEdit(a) {
        setEditing(a);
        setFormOpen(true);
    }
    // Group by type
    const byType = {};
    accounts.forEach((a) => {
        (byType[a.type] = byType[a.type] || []).push(a);
    });
    const sorted = Object.entries(byType).sort((a, b) => b[1].reduce((s, x) => s + (x.balance || 0), 0) -
        a[1].reduce((s, x) => s + (x.balance || 0), 0));
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-5 flex-wrap gap-3", children: [_jsx("h2", { className: "text-[22px] font-semibold", children: "Assets" }), _jsx("button", { className: "btn btn-primary", onClick: openNew, children: "+ Add Asset" })] }), accounts.length === 0 ? (_jsxs("div", { className: "text-center py-12 text-text-dim col-span-full", children: [_jsx("div", { className: "text-4xl mb-3 opacity-40", children: "\uD83C\uDFE6" }), _jsx("p", { className: "text-sm mb-4", children: "No assets added yet." }), _jsx("button", { className: "btn btn-primary", onClick: openNew, children: "+ Add First Asset" })] })) : (_jsx("div", { className: "grid grid-cols-3 max-md:grid-cols-1 gap-5", children: sorted.map(([type, accs]) => {
                    const total = accs.reduce((s, a) => s + (a.balance || 0), 0);
                    return (_jsxs("div", { className: "bg-bg-card border border-border rounded-xl p-6 min-h-[200px] hover:border-[#363a50] transition-colors", children: [_jsxs("div", { className: "flex items-center justify-between mb-5", children: [_jsxs("span", { className: "text-[14px] font-semibold uppercase tracking-wider text-text-dim", children: [ACCT_ICONS[type] || "📁", " ", type] }), _jsx("span", { className: "font-mono text-lg font-semibold", children: fmt(total) })] }), accs.map((a, i) => (_jsxs("div", { children: [i > 0 && _jsx("div", { className: "h-px bg-border/50 mx-1" }), _jsxs("div", { className: "flex items-start justify-between py-3 -mx-2 px-2 rounded-md hover:bg-accent/[0.04] cursor-pointer transition-all", onClick: () => openEdit(a), children: [_jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2 mb-1.5", children: [a.owner && (_jsx("span", { className: "inline-flex px-2 py-0.5 rounded-xl text-[10px] font-semibold bg-purple-dim text-purple tracking-wide", children: a.owner })), a.notes && (_jsxs("span", { className: "relative group", children: [_jsx("span", { className: "inline-flex items-center justify-center w-4 h-4 rounded-full border-[1.5px] border-text-muted text-text-muted text-[9px] font-bold cursor-default hover:border-accent hover:text-accent transition-all", children: "i" }), _jsx("span", { className: "absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 bg-[#1e2130] border border-border text-text-dim text-xs px-3 py-2.5 rounded-lg min-w-[200px] max-w-[320px] opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-[0_8px_24px_rgba(0,0,0,0.4)] z-20 leading-relaxed whitespace-pre-wrap", children: a.notes })] }))] }), _jsxs("div", { className: "flex items-center gap-1.5 text-[11px] text-text-muted flex-wrap", children: [a.institution && (_jsxs(_Fragment, { children: [_jsx("span", { children: a.institution }), _jsx("span", { className: "opacity-35 text-[10px]", children: "\u00B7" })] })), _jsx("span", { className: "font-mono text-text-dim", children: fmt(a.balance) })] }), a.lastUpdated && (_jsxs("div", { className: "mt-3 text-[10px] text-text-dim font-medium tracking-wide", children: ["Updated ", fmtDate(a.lastUpdated)] }))] }), _jsx("span", { className: "text-text-muted text-lg opacity-60 hover:opacity-100 hover:text-accent transition-all self-center ml-2", children: "\u203A" })] })] }, a.id)))] }, type));
                }) })), _jsx(AccountForm, { open: formOpen, onClose: () => setFormOpen(false), onSaved: load, onToast: onToast, account: editing })] }));
}
