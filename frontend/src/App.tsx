import { useState, useCallback } from "react";
import DashboardView from "./components/dashboard/DashboardView";
import AccountsView from "./components/accounts/AccountsView";
import BudgetView from "./components/budget/BudgetView";
import SubscriptionsView from "./components/subscriptions/SubscriptionsView";
import SettingsModal from "./components/layout/SettingsModal";
import Toast from "./components/layout/Toast";

type View = "dashboard" | "accounts" | "budget" | "subscriptions";

const NAV_ITEMS: { view: View; icon: string; label: string; desktop: string }[] = [
  { view: "dashboard", icon: "📊", label: "Home", desktop: "Dashboard" },
  { view: "accounts", icon: "🏦", label: "Assets", desktop: "Assets" },
  { view: "budget", icon: "💰", label: "Budget", desktop: "Budget" },
  { view: "subscriptions", icon: "🔄", label: "Bills", desktop: "Bills" },
];

export default function App() {
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);

  // Refresh key - increment to force re-mount of views after global data changes
  const [refreshKey, setRefreshKey] = useState(0);

  const showToast = useCallback((msg: string, err?: boolean) => {
    setToast({ msg, err });
  }, []);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="min-h-screen min-h-dvh">
      {/* Top Nav */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-8 h-[60px] bg-bg/85 backdrop-blur-xl border-b border-border max-md:px-4">
        <div className="flex items-center gap-2.5 font-semibold text-lg tracking-tight">
          <div className="w-7 h-7 bg-accent rounded-lg flex items-center justify-center text-sm text-white shadow-[0_0_16px_rgba(74,108,247,0.3)]">
            ⬡
          </div>
          <span className="max-md:hidden">Financial Insider</span>
        </div>

        {/* Desktop tabs */}
        <div className="hidden md:flex gap-0.5">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.view}
              onClick={() => setActiveView(item.view)}
              className={`px-4 py-1.5 rounded-md text-[13px] font-medium whitespace-nowrap transition-all ${
                activeView === item.view
                  ? "text-accent bg-accent/[0.1]"
                  : "text-text-dim hover:text-text hover:bg-white/[0.04]"
              }`}
            >
              {item.desktop}
            </button>
          ))}
        </div>

        <div className="flex items-center">
          <button
            className="p-1.5 px-2.5 border border-border rounded-lg text-text-dim hover:border-accent hover:text-text transition-all"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-[1] max-w-[1280px] mx-auto px-8 py-7 pb-[60px] max-md:px-4 max-md:pb-24">
        <div key={refreshKey}>
          {activeView === "dashboard" && <DashboardView />}
          {activeView === "accounts" && <AccountsView onToast={showToast} />}
          {activeView === "budget" && (
            <BudgetView onToast={showToast} />
          )}
          {activeView === "subscriptions" && <SubscriptionsView onToast={showToast} />}
        </div>
      </main>

      {/* Mobile Nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-bg/95 backdrop-blur-xl border-t border-border px-2 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5">
        <div className="flex justify-around items-center">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.view}
              onClick={() => setActiveView(item.view)}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 text-[10px] font-medium rounded-lg transition-colors ${
                activeView === item.view ? "text-accent" : "text-text-muted"
              }`}
            >
              <span className="text-xl leading-none">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onToast={showToast}
        onDataChange={refresh}
      />

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.msg}
          isError={toast.err}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
