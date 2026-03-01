import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const topColors = {
    blue: "bg-accent",
    green: "bg-green",
    amber: "bg-amber",
    purple: "bg-purple",
};
export default function StatCard({ label, value, color }) {
    return (_jsxs("div", { className: "relative bg-bg-card border border-border rounded-xl p-5 max-md:p-4", children: [_jsx("div", { className: `absolute top-0 left-0 right-0 h-0.5 ${topColors[color]} rounded-t-xl` }), _jsx("div", { className: "text-[12px] font-medium uppercase tracking-wider text-text-muted mb-2", children: label }), _jsx("div", { className: "font-mono text-[28px] max-md:text-[22px] font-semibold tracking-tight", children: value })] }));
}
