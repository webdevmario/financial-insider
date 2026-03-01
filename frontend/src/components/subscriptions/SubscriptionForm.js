import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import Modal from "../layout/Modal";
import { api } from "../../lib/api";
import { fmtP } from "../../lib/formatters";
import { SUB_CATEGORIES } from "../../types";
export default function SubscriptionForm({ open, onClose, onSaved, onToast, subscription, }) {
    const [name, setName] = useState("");
    const [category, setCategory] = useState("Other");
    const [frequency, setFrequency] = useState("monthly");
    const [amount, setAmount] = useState("");
    const [nextCharge, setNextCharge] = useState("");
    const [splitBy, setSplitBy] = useState(1);
    const [status, setStatus] = useState("");
    const [notes, setNotes] = useState("");
    const [showConfirm, setShowConfirm] = useState(false);
    useEffect(() => {
        if (subscription) {
            setName(subscription.name);
            setCategory(subscription.category);
            setFrequency(subscription.frequency);
            setAmount(String(subscription.amount || ""));
            setNextCharge(subscription.nextCharge || "");
            setSplitBy(subscription.splitBy || 1);
            setStatus(subscription.status || "");
            setNotes(subscription.notes || "");
        }
        else {
            setName("");
            setCategory("Other");
            setFrequency("monthly");
            setAmount("");
            setNextCharge("");
            setSplitBy(1);
            setStatus("");
            setNotes("");
        }
        setShowConfirm(false);
    }, [subscription, open]);
    const myCost = (parseFloat(amount) || 0) / (splitBy || 1);
    async function handleSave() {
        if (!name.trim()) {
            onToast("Enter service name", true);
            return;
        }
        const payload = {
            name: name.trim(),
            category,
            frequency,
            amount: parseFloat(amount) || 0,
            nextCharge: nextCharge || null,
            splitBy,
            status: status || null,
            notes: notes || null,
        };
        try {
            if (subscription) {
                await api.subscriptions.update(subscription.id, payload);
                onToast("Updated");
            }
            else {
                await api.subscriptions.create(payload);
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
        if (!subscription)
            return;
        try {
            await api.subscriptions.delete(subscription.id);
            onToast("Deleted");
            onSaved();
            onClose();
        }
        catch {
            onToast("Failed to delete", true);
        }
    }
    if (showConfirm) {
        return (_jsxs(Modal, { open: open, onClose: () => setShowConfirm(false), title: `Remove "${subscription?.name}"?`, children: [_jsx("p", { className: "text-sm text-text-dim mb-6", children: "This action cannot be undone." }), _jsxs("div", { className: "flex justify-end gap-2.5 pt-4 border-t border-border", children: [_jsx("button", { className: "btn", onClick: () => setShowConfirm(false), children: "Cancel" }), _jsx("button", { className: "btn btn-danger", onClick: handleDelete, children: "Delete" })] })] }));
    }
    return (_jsx(Modal, { open: open, onClose: onClose, title: subscription ? "Edit Bill" : "Add Bill", children: _jsxs("div", { className: "flex flex-col gap-4", children: [_jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Service Name" }), _jsx("input", { type: "text", placeholder: "e.g. Netflix, Allstate", value: name, onChange: (e) => setName(e.target.value) })] }), _jsxs("div", { className: "grid grid-cols-2 max-md:grid-cols-1 gap-3", children: [_jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Category" }), _jsx("select", { value: category, onChange: (e) => setCategory(e.target.value), children: SUB_CATEGORIES.map((c) => (_jsx("option", { value: c, children: c }, c))) })] }), _jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Frequency" }), _jsxs("select", { value: frequency, onChange: (e) => setFrequency(e.target.value), children: [_jsx("option", { value: "monthly", children: "Monthly" }), _jsx("option", { value: "quarterly", children: "Quarterly" }), _jsx("option", { value: "annual", children: "Annual" })] })] })] }), _jsxs("div", { className: "grid grid-cols-2 max-md:grid-cols-1 gap-3", children: [_jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Charge Amount" }), _jsx("input", { type: "number", step: "0.01", placeholder: "0.00", value: amount, onChange: (e) => setAmount(e.target.value) })] }), _jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Next Charge Date" }), _jsx("input", { type: "date", value: nextCharge, onChange: (e) => setNextCharge(e.target.value) })] })] }), _jsxs("div", { className: "grid grid-cols-2 max-md:grid-cols-1 gap-3", children: [_jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Split Between" }), _jsxs("select", { value: splitBy, onChange: (e) => setSplitBy(parseInt(e.target.value)), children: [_jsx("option", { value: 1, children: "Just me" }), _jsx("option", { value: 2, children: "2 people" }), _jsx("option", { value: 3, children: "3 people" }), _jsx("option", { value: 4, children: "4 people" })] })] }), _jsxs("div", { className: "input-group", children: [_jsx("label", { children: "My Cost" }), _jsx("div", { className: "font-mono px-3.5 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-green", children: fmtP(myCost) })] })] }), _jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Status" }), _jsxs("select", { value: status, onChange: (e) => setStatus(e.target.value), children: [_jsx("option", { value: "", children: "None" }), _jsx("option", { value: "essential", children: "Essential" }), _jsx("option", { value: "review", children: "Under Review" })] })] }), _jsxs("div", { className: "input-group", children: [_jsx("label", { children: "Notes (optional)" }), _jsx("textarea", { rows: 2, placeholder: "e.g. Split with mom, seasonal pricing...", value: notes, onChange: (e) => setNotes(e.target.value) })] }), _jsxs("div", { className: "flex justify-end gap-2.5 pt-4 border-t border-border max-md:pb-[env(safe-area-inset-bottom)]", children: [subscription && (_jsx("button", { className: "btn btn-danger btn-sm", onClick: () => setShowConfirm(true), children: "\uD83D\uDDD1\uFE0F Delete" })), _jsx("button", { className: "btn", onClick: onClose, children: "Cancel" }), _jsx("button", { className: "btn btn-primary", onClick: handleSave, children: subscription ? "Update" : "Add" })] })] }) }));
}
