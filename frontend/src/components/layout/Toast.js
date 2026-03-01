import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect } from "react";
export default function Toast({ message, isError, onClose }) {
    useEffect(() => {
        const t = setTimeout(onClose, 2200);
        return () => clearTimeout(t);
    }, [onClose]);
    return (_jsx("div", { className: `fixed bottom-6 right-6 max-md:bottom-20 max-md:right-4 max-md:left-4 z-[300]
        bg-bg-card border rounded-xl px-5 py-3.5 text-[13px] shadow-[0_8px_32px_rgba(0,0,0,0.3)]
        animate-[slideUp_0.3s_ease] ${isError ? "border-red" : "border-green"}`, children: message }));
}
