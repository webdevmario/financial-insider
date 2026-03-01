import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback } from "react";
import DashboardView from "./components/dashboard/DashboardView";
import AccountsView from "./components/accounts/AccountsView";
import BudgetView from "./components/budget/BudgetView";
import SubscriptionsView from "./components/subscriptions/SubscriptionsView";
import SettingsModal from "./components/layout/SettingsModal";
import Toast from "./components/layout/Toast";
const NAV_ITEMS = [
    { view: "dashboard", icon: "📊", label: "Home", desktop: "Dashboard" },
    { view: "accounts", icon: "🏦", label: "Assets", desktop: "Assets" },
    { view: "budget", icon: "💰", label: "Budget", desktop: "Budget" },
    { view: "subscriptions", icon: "🔄", label: "Bills", desktop: "Bills" },
];
export default function App() {
    const [activeView, setActiveView] = useState("dashboard");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [toast, setToast] = useState(null);
    // Refresh key - increment to force re-mount of views after global data changes
    const [refreshKey, setRefreshKey] = useState(0);
    const showToast = useCallback((msg, err) => {
        setToast({ msg, err });
    }, []);
    const refresh = useCallback(() => {
        setRefreshKey((k) => k + 1);
    }, []);
    return (_jsxs("div", { className: "min-h-screen min-h-dvh", children: [_jsxs("nav", { className: "sticky top-0 z-50 grid grid-cols-[1fr_auto_1fr] items-center px-8 h-[60px] bg-bg/85 backdrop-blur-xl border-b border-border max-md:px-4", children: [_jsxs("div", { className: "flex items-center gap-2.5 font-semibold text-lg tracking-tight", children: [_jsx("div", { className: "w-7 h-7 bg-accent rounded-lg flex items-center justify-center text-sm text-white shadow-[0_0_16px_rgba(74,108,247,0.3)]", children: "\u2B21" }), _jsx("span", { className: "max-md:hidden", children: "Financial Insider" })] }), _jsx("div", { className: "hidden md:flex gap-1 bg-bg-input rounded-[10px] p-1", children: NAV_ITEMS.map((item) => (_jsx("button", { onClick: () => setActiveView(item.view), className: `px-[18px] py-[7px] rounded-[7px] text-[13px] font-medium whitespace-nowrap transition-all ${activeView === item.view
                                ? "bg-bg-card text-text shadow-[0_1px_4px_rgba(0,0,0,0.2)]"
                                : "text-text-dim hover:text-text"}`, children: item.desktop }, item.view))) }), _jsx("div", { className: "flex items-center justify-end", children: _jsx("button", { className: "p-1.5 px-2.5 border border-border rounded-lg text-text-dim hover:border-accent hover:text-text transition-all", onClick: () => setSettingsOpen(true), title: "Settings", children: "\u2699\uFE0F" }) })] }), _jsx("main", { className: "relative z-[1] max-w-[1280px] mx-auto px-8 py-7 pb-[60px] max-md:px-4 max-md:pb-24", children: _jsxs("div", { children: [activeView === "dashboard" && _jsx(DashboardView, {}), activeView === "accounts" && _jsx(AccountsView, { onToast: showToast }), activeView === "budget" && (_jsx(BudgetView, { onToast: showToast, onDataChange: refresh })), activeView === "subscriptions" && _jsx(SubscriptionsView, { onToast: showToast })] }, refreshKey) }), _jsx("div", { className: "md:hidden fixed bottom-0 left-0 right-0 z-50 bg-bg/95 backdrop-blur-xl border-t border-border px-2 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5", children: _jsx("div", { className: "flex justify-around items-center", children: NAV_ITEMS.map((item) => (_jsxs("button", { onClick: () => setActiveView(item.view), className: `flex flex-col items-center gap-0.5 px-2.5 py-1.5 text-[10px] font-medium rounded-lg transition-colors ${activeView === item.view ? "text-accent" : "text-text-muted"}`, children: [_jsx("span", { className: "text-xl leading-none", children: item.icon }), item.label] }, item.view))) }) }), _jsx(SettingsModal, { open: settingsOpen, onClose: () => setSettingsOpen(false), onToast: showToast, onDataChange: refresh }), toast && (_jsx(Toast, { message: toast.msg, isError: toast.err, onClose: () => setToast(null) }))] }));
}
