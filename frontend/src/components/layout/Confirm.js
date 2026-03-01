import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Modal from "./Modal";
export default function Confirm({ open, title, message, onConfirm, onCancel }) {
    return (_jsxs(Modal, { open: open, onClose: onCancel, title: title, children: [_jsx("p", { className: "text-sm text-text-dim mb-6 leading-relaxed", children: message }), _jsxs("div", { className: "flex justify-end gap-2.5 pt-4 border-t border-border", children: [_jsx("button", { onClick: onCancel, className: "btn", children: "Cancel" }), _jsx("button", { onClick: onConfirm, className: "btn btn-danger", children: "Delete" })] })] }));
}
