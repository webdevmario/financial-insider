import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { fmtP } from "../../lib/formatters";
import StatCard from "../layout/StatCard";
import SubscriptionForm from "./SubscriptionForm";
export default function SubscriptionsView({ onToast }) {
    const [subs, setSubs] = useState([]);
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [catFilter, setCatFilter] = useState("");
    const [freqFilter, setFreqFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const load = useCallback(() => {
        api.subscriptions.list().then(setSubs).catch(() => { });
    }, []);
    useEffect(() => { load(); }, [load]);
    function openNew() { setEditing(null); setFormOpen(true); }
    function openEdit(s) { setEditing(s); setFormOpen(true); }
    // Calculations
    let mT = 0, qT = 0, aT = 0;
    subs.forEach((s) => {
        const my = s.amount / (s.splitBy || 1);
        if (s.frequency === "monthly")
            mT += my;
        else if (s.frequency === "quarterly")
            qT += my / 3;
        else if (s.frequency === "annual")
            aT += my / 12;
    });
    // Pay period breakdown
    let pp1 = 0, pp2 = 0, pp1c = 0, pp2c = 0;
    subs.forEach((s) => {
        const my = s.amount / (s.splitBy || 1);
        const me = s.frequency === "monthly" ? my : s.frequency === "quarterly" ? my / 3 : my / 12;
        if (!s.nextCharge)
            return;
        const day = parseInt(s.nextCharge.split("-")[2]);
        if (day <= 15) {
            pp1 += me;
            pp1c++;
        }
        else {
            pp2 += me;
            pp2c++;
        }
    });
    // Categories for filter
    const categories = [...new Set(subs.map((s) => s.category || "General"))].sort();
    // Apply filters
    let filtered = subs;
    if (catFilter)
        filtered = filtered.filter((s) => (s.category || "General") === catFilter);
    if (freqFilter)
        filtered = filtered.filter((s) => s.frequency === freqFilter);
    if (statusFilter)
        filtered = filtered.filter((s) => (s.status || "") === statusFilter);
    filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-5 flex-wrap gap-3", children: [_jsx("h2", { className: "text-[22px] font-semibold", children: "Bills" }), _jsx("button", { className: "btn btn-primary", onClick: openNew, children: "+ Add Bill" })] }), _jsxs("div", { className: "grid grid-cols-3 max-md:grid-cols-1 gap-5 mb-6", children: [_jsx(StatCard, { label: "Monthly Total", value: fmtP(mT), color: "blue" }), _jsx(StatCard, { label: "Quarterly (Mo. Equiv.)", value: fmtP(qT), color: "amber" }), _jsx(StatCard, { label: "Annual (Mo. Equiv.)", value: fmtP(aT), color: "green" })] }), _jsxs("div", { className: "bg-bg-card border border-border rounded-xl px-6 py-5 mb-6", children: [_jsx("div", { className: "text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3", children: "Pay Period Breakdown" }), _jsxs("div", { className: "flex gap-4 max-md:flex-col", children: [_jsxs("div", { className: "flex-1 bg-bg-input rounded-lg px-4 py-3.5", children: [_jsx("div", { className: "text-[11px] text-text-muted mb-1", children: "1st \u2014 15th" }), _jsx("div", { className: "font-mono text-xl font-semibold", children: fmtP(pp1) }), _jsxs("div", { className: "text-[11px] text-text-muted mt-0.5", children: [pp1c, " item", pp1c !== 1 ? "s" : ""] })] }), _jsxs("div", { className: "flex-1 bg-bg-input rounded-lg px-4 py-3.5", children: [_jsx("div", { className: "text-[11px] text-text-muted mb-1", children: "16th \u2014 31st" }), _jsx("div", { className: "font-mono text-xl font-semibold", children: fmtP(pp2) }), _jsxs("div", { className: "text-[11px] text-text-muted mt-0.5", children: [pp2c, " item", pp2c !== 1 ? "s" : ""] })] })] })] }), _jsxs("div", { className: "flex gap-2 items-center mb-3 flex-wrap", children: [_jsx("span", { className: "text-[11px] font-semibold uppercase tracking-wider text-text-muted", children: "Filter by" }), _jsxs("select", { value: catFilter, onChange: (e) => setCatFilter(e.target.value), className: "!w-auto !text-xs !py-1 !px-2.5", children: [_jsx("option", { value: "", children: "All Categories" }), categories.map((c) => (_jsx("option", { value: c, children: c }, c)))] }), _jsxs("select", { value: freqFilter, onChange: (e) => setFreqFilter(e.target.value), className: "!w-auto !text-xs !py-1 !px-2.5", children: [_jsx("option", { value: "", children: "All Frequencies" }), _jsx("option", { value: "monthly", children: "Monthly" }), _jsx("option", { value: "quarterly", children: "Quarterly" }), _jsx("option", { value: "annual", children: "Annual" })] }), _jsxs("select", { value: statusFilter, onChange: (e) => setStatusFilter(e.target.value), className: "!w-auto !text-xs !py-1 !px-2.5", children: [_jsx("option", { value: "", children: "All Statuses" }), _jsx("option", { value: "essential", children: "Essential" }), _jsx("option", { value: "review", children: "Under Review" })] })] }), _jsxs("div", { className: "bg-bg-card border border-border rounded-xl", children: [_jsxs("div", { className: "hidden md:grid grid-cols-[1fr_120px_100px_110px_32px] items-center px-4 py-2.5 border-b border-border text-[11px] font-semibold uppercase tracking-wider text-text-muted", children: [_jsx("span", { children: "Service" }), _jsx("span", { children: "Category" }), _jsx("span", { children: "Frequency" }), _jsx("span", { className: "text-right", children: "Amount" }), _jsx("span", {})] }), filtered.length === 0 ? (_jsxs("div", { className: "text-center py-12 text-text-dim", children: [_jsx("div", { className: "text-4xl mb-3 opacity-40", children: "\uD83D\uDD04" }), _jsx("p", { className: "text-sm", children: subs.length === 0 ? "No bills yet" : "No bills match filters" })] })) : (filtered.map((s) => {
                        const isSplit = s.splitBy > 1;
                        const myCost = s.amount / (s.splitBy || 1);
                        const freqClass = s.frequency === "monthly"
                            ? "bg-accent-glow text-accent"
                            : s.frequency === "quarterly"
                                ? "bg-amber-dim text-amber"
                                : "bg-green-dim text-green";
                        return (_jsxs("div", { className: "grid grid-cols-[1fr_120px_100px_110px_32px] max-md:flex max-md:gap-2 items-center px-4 py-3 border-b border-border/40 text-sm cursor-pointer hover:bg-accent/[0.04] transition-all", onClick: () => openEdit(s), children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "flex items-center flex-wrap gap-1", children: [_jsx("span", { children: s.name }), isSplit && (_jsx("span", { className: "text-[10px] text-cyan bg-cyan/10 px-1.5 py-0.5 rounded-xl", children: "Shared" })), s.status === "review" && (_jsx("span", { title: "Under review", className: "text-[13px] cursor-default", children: "\u26A0\uFE0F" }))] }), s.notes && (_jsx("div", { className: "text-[11px] text-text-muted mt-1 truncate max-w-[300px]", children: s.notes }))] }), _jsx("span", { className: "max-md:hidden", children: _jsx("span", { className: "inline-flex px-2.5 py-0.5 rounded-2xl text-[11px] font-semibold bg-purple-dim text-purple", children: s.category || "General" }) }), _jsx("span", { className: "max-md:hidden", children: _jsx("span", { className: `inline-flex px-2.5 py-0.5 rounded-2xl text-[11px] font-semibold ${freqClass}`, children: s.frequency }) }), _jsx("span", { className: "font-mono text-right max-md:ml-auto max-md:flex-shrink-0", children: fmtP(myCost) }), _jsx("span", { className: "text-text-muted text-lg opacity-60 text-right", children: "\u203A" })] }, s.id));
                    }))] }), _jsx(SubscriptionForm, { open: formOpen, onClose: () => setFormOpen(false), onSaved: load, onToast: onToast, subscription: editing })] }));
}
