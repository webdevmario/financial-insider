import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
export default function Modal({ open, onClose, title, titleExtra, children }) {
    const contentRef = useRef(null);
    useEffect(() => {
        if (!open)
            return;
        const handler = (e) => {
            if (e.key === "Escape")
                onClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [open, onClose]);
    // Focus first input when modal opens
    useEffect(() => {
        if (!open)
            return;
        const t = setTimeout(() => {
            const input = contentRef.current?.querySelector("input:not([disabled]), select:not([disabled]), textarea:not([disabled])");
            input?.focus();
        }, 100);
        return () => clearTimeout(t);
    }, [open]);
    if (!open)
        return null;
    return (_jsx("div", { className: "fixed inset-0 z-[200] bg-black/60 backdrop-blur-[4px] flex justify-center items-center max-md:items-end", onClick: (e) => {
            if (e.target === e.currentTarget)
                onClose();
        }, children: _jsxs("div", { ref: contentRef, className: "bg-bg-card border border-border rounded-2xl p-8 w-[520px] max-w-[90vw] max-h-[85vh] overflow-y-auto shadow-[0_24px_48px_rgba(0,0,0,0.4)]\n          max-md:max-w-full max-md:w-full max-md:max-h-[85dvh] max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:p-5 max-md:pb-8 max-md:animate-[sheetUp_0.25s_ease-out]", children: [_jsx("div", { className: "hidden max-md:block w-9 h-1 rounded-full bg-white/20 mx-auto mb-4" }), _jsxs("div", { className: "flex items-center justify-between mb-5", children: [_jsxs("h2", { className: "text-[22px] max-md:text-xl font-semibold flex items-center gap-2", children: [title, titleExtra] }), _jsx("button", { onClick: onClose, className: "p-1.5 px-2.5 border border-border rounded-lg text-text-dim hover:border-accent hover:text-text transition-all text-base", children: "\u2715" })] }), children] }) }));
}
