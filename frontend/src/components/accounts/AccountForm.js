import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import Modal from "../layout/Modal";
import { api } from "../../lib/api";
import { fmt, fmtDate } from "../../lib/formatters";
import { ACCOUNT_TYPES, OWNERS, INSTITUTIONS } from "../../types";
export default function AccountForm({ open, onClose, onSaved, onToast, account }) {
    const [type, setType] = useState("Checking");
    const [balance, setBalance] = useState("");
    const [owner, setOwner] = useState("");
    const [institution, setInstitution] = useState("");
    const [notes, setNotes] = useState("");
    const [homeValue, setHomeValue] = useState("");
    const [mortgageBalance, setMortgageBalance] = useState("");
    const [showConfirm, setShowConfirm] = useState(false);
    useEffect(() => {
        if (account) {
            setType(account.type);
            setBalance(account.type === "Home Equity" ? "" : String(account.balance || ""));
            setOwner(account.owner || "");
            setInstitution(account.institution || "");
            setNotes(account.notes || "");
            setHomeValue(String(account.homeValue || ""));
            setMortgageBalance(String(account.mortgageBalance || ""));
        }
        else {
            setType("Checking");
            setBalance("");
            setOwner("");
            setInstitution("");
            setNotes("");
            setHomeValue("");
            setMortgageBalance("");
        }
        setShowConfirm(false);
    }, [account, open]);
    const isHE = type === "Home Equity";
    const isVehicle = type === "Vehicle";
    const equityPreview = (parseFloat(homeValue) || 0) - (parseFloat(mortgageBalance) || 0);
    async function handleSave() {
        let bal;
        if (isHE) {
            bal = equityPreview;
        }
        else {
            bal = parseFloat(balance) || 0;
        }
        const payload = {
            type,
            balance: bal,
            owner: owner || null,
            institution: institution || null,
            notes: notes || null,
            homeValue: isHE ? parseFloat(homeValue) || 0 : null,
            mortgageBalance: isHE ? parseFloat(mortgageBalance) || 0 : null,
        };
        try {
            if (account) {
                await api.accounts.update(account.id, payload);
                onToast("Updated");
            }
            else {
                await api.accounts.create(payload);
                onToast("Added");
            }
            onSaved();
            onClose();
        }
        catch {
            onToast("Failed to save", true);
        }
    }
    async function handleDelete() {
        if (!account)
            return;
        try {
            await api.accounts.delete(account.id);
            onToast("Deleted");
            onSaved();
            onClose();
        }
        catch {
            onToast("Failed to delete", true);
        }
    }
    if (showConfirm) {
        const label = account ? `${account.type}${account.owner ? ` (${account.owner})` : ""}` : "";
        return (_jsxs(Modal, { open: open, onClose: () => setShowConfirm(false), title: `Delete "${label}"?`, children: [_jsx("p", { className: "text-sm text-text-dim mb-6", children: "This action cannot be undone." }), _jsxs("div", { className: "flex justify-end gap-2.5 pt-4 border-t border-border", children: [_jsx("button", { className: "btn", onClick: () => setShowConfirm(false), children: "Cancel" }), _jsx("button", { className: "btn btn-danger", onClick: handleDelete, children: "Delete" })] })] }));
    }
    const titleExtra = account?.lastUpdated ? (_jsxs("span", { className: "relative group", children: [_jsx("span", { className: "inline-flex items-center justify-center w-4 h-4 rounded-full border-[1.5px] border-text-muted text-text-muted text-[9px] font-bold cursor-default hover:border-accent hover:text-accent transition-all", children: "i" }), _jsxs("span", { className: "absolute top-full left-1/2 -translate-x-1/2 mt-2.5 bg-[#1e2130] border border-border text-text-dim text-xs px-3 py-2.5 rounded-lg min-w-[160px] opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-[0_8px_24px_rgba(0,0,0,0.4)] z-20 whitespace-nowrap", children: ["Last updated ", fmtDate(account.lastUpdated)] })] })) : undefined;
    return (_jsx(Modal, { open: open, onClose: onClose, title: account ? "Edit Asset" : "Add Asset", titleExtra: titleExtra, children: _jsxs("div", { className: "flex flex-col gap-4", children: [_jsxs("div", { className: "grid grid-cols-2 max-md:grid-cols-1 gap-3", children: [_jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Type" }), _jsx("select", { value: type, onChange: (e) => setType(e.target.value), children: ACCOUNT_TYPES.map((t) => (_jsx("option", { value: t, children: t }, t))) })] }), !isHE && (_jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Value" }), _jsx("input", { type: "number", step: "0.01", placeholder: "0.00", value: balance, onChange: (e) => setBalance(e.target.value) })] }))] }), isHE && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "grid grid-cols-2 max-md:grid-cols-1 gap-3", children: [_jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Home Value" }), _jsx("input", { type: "number", step: "0.01", placeholder: "0.00", value: homeValue, onChange: (e) => setHomeValue(e.target.value) })] }), _jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Mortgage Balance" }), _jsx("input", { type: "number", step: "0.01", placeholder: "0.00", value: mortgageBalance, onChange: (e) => setMortgageBalance(e.target.value) })] })] }), _jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Your Equity" }), _jsx("div", { className: "font-mono px-3.5 py-2.5 rounded-lg bg-bg-input border border-border text-base font-semibold text-green", children: fmt(equityPreview) })] })] })), _jsxs("div", { className: "grid grid-cols-2 max-md:grid-cols-1 gap-3", children: [_jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Owner" }), _jsx("select", { value: owner, onChange: (e) => setOwner(e.target.value), children: OWNERS.map((o) => (_jsx("option", { value: o, children: o || "None" }, o))) })] }), _jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Held At" }), _jsx("select", { value: institution, onChange: (e) => setInstitution(e.target.value), children: INSTITUTIONS.map((i) => (_jsx("option", { value: i, children: i || "None" }, i))) })] })] }), (isVehicle || isHE) && (_jsx("div", { className: "text-xs text-text-dim bg-bg-input rounded-lg px-3.5 py-2.5 leading-relaxed", children: isHE ? (_jsxs(_Fragment, { children: ["\uD83D\uDCA1 Check value on ", _jsx("a", { href: "https://www.zillow.com", target: "_blank", rel: "noreferrer", className: "text-accent hover:underline", children: "Zillow" }), " or ", _jsx("a", { href: "https://www.redfin.com", target: "_blank", rel: "noreferrer", className: "text-accent hover:underline", children: "Redfin" }), "."] })) : (_jsxs(_Fragment, { children: ["\uD83D\uDCA1 Check value at ", _jsx("a", { href: "https://www.kbb.com/whats-my-car-worth/", target: "_blank", rel: "noreferrer", className: "text-accent hover:underline", children: "KBB.com" })] })) })), _jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Notes (optional)" }), _jsx("textarea", { rows: 3, placeholder: "Add context, reminders, or details...", value: notes, onChange: (e) => setNotes(e.target.value) })] }), _jsxs("div", { className: "flex justify-end gap-2.5 pt-4 border-t border-border max-md:pb-[env(safe-area-inset-bottom)]", children: [account && (_jsx("button", { className: "btn btn-danger btn-sm", onClick: () => setShowConfirm(true), children: "\uD83D\uDDD1\uFE0F Delete" })), _jsx("button", { className: "btn", onClick: onClose, children: "Cancel" }), _jsx("button", { className: "btn btn-primary", onClick: handleSave, children: account ? "Update" : "Add" })] })] }) }));
}
