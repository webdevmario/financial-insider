import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { fmt, fmtDate } from "../../lib/formatters";
import AccountForm from "./AccountForm";
import type { Account } from "../../types";
import { ACCT_ICONS } from "../../types";

interface AccountsViewProps {
  onToast: (msg: string, err?: boolean) => void;
}

export default function AccountsView({ onToast }: AccountsViewProps) {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);

  const load = useCallback(() => {
    return api.accounts.list().then(setAccounts).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(a: Account) {
    setEditing(a);
    setFormOpen(true);
  }

  // Group by type
  const byType: Record<string, Account[]> = {};
  accounts.forEach((a) => {
    (byType[a.type] = byType[a.type] || []).push(a);
  });

  const sorted = Object.entries(byType).sort(
    (a, b) =>
      b[1].reduce((s, x) => s + (x.balance || 0), 0) -
      a[1].reduce((s, x) => s + (x.balance || 0), 0)
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="w-7 h-7 border-2 border-border border-t-accent rounded-full animate-spin" />
        <span className="text-sm text-text-muted">Loading…</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h2 className="text-[22px] font-semibold">Assets</h2>
        <button className="btn btn-primary" onClick={openNew}>+ Add Asset</button>
      </div>

      {accounts.length === 0 ? (
        <div className="text-center py-12 text-text-dim col-span-full">
          <div className="text-4xl mb-3 opacity-40">🏦</div>
          <p className="text-sm mb-4">No assets added yet.</p>
          <button className="btn btn-primary" onClick={openNew}>+ Add First Asset</button>
        </div>
      ) : (
        <div className="grid grid-cols-3 max-md:grid-cols-1 gap-5">
          {sorted.map(([type, accs]) => {
            const total = accs.reduce((s, a) => s + (a.balance || 0), 0);
            return (
              <div key={type} className="bg-bg-card border border-border rounded-xl p-6 min-h-[200px] hover:border-[#363a50] transition-colors">
                <div className="flex items-center justify-between mb-5">
                  <span className="text-[14px] font-semibold uppercase tracking-wider text-text-dim">
                    {ACCT_ICONS[type] || "📁"} {type}
                  </span>
                  <span className="font-mono text-lg font-semibold">{fmt(total)}</span>
                </div>

                {accs.map((a, i) => (
                  <div key={a.id}>
                    {i > 0 && <div className="h-px bg-border/50 mx-1" />}
                    <div
                      className="flex items-start justify-between py-3 -mx-2 px-2 rounded-md hover:bg-accent/[0.04] cursor-pointer transition-all"
                      onClick={() => openEdit(a)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          {a.owner && (
                            <span className="inline-flex px-2 py-0.5 rounded-xl text-[10px] font-semibold bg-purple-dim text-purple tracking-wide">
                              {a.owner}
                            </span>
                          )}
                          {a.notes && (
                            <span className="relative group">
                              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border-[1.5px] border-text-muted text-text-muted text-[9px] font-bold cursor-default hover:border-accent hover:text-accent transition-all">
                                i
                              </span>
                              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 bg-[#1e2130] border border-border text-text-dim text-xs px-3 py-2.5 rounded-lg min-w-[200px] max-w-[320px] opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-[0_8px_24px_rgba(0,0,0,0.4)] z-20 leading-relaxed whitespace-pre-wrap">
                                {a.notes}
                              </span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-text-muted flex-wrap">
                          {a.institution && (
                            <>
                              <span>{a.institution}</span>
                              <span className="opacity-35 text-[10px]">·</span>
                            </>
                          )}
                          <span className="font-mono text-text-dim">{fmt(a.balance)}</span>
                        </div>
                        {a.lastUpdated && (
                          <div className="mt-3 text-[10px] text-text-dim font-medium tracking-wide">
                            Updated {fmtDate(a.lastUpdated)}
                          </div>
                        )}
                      </div>
                      <span className="text-text-muted text-lg opacity-60 hover:opacity-100 hover:text-accent transition-all self-center ml-2">
                        ›
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <AccountForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={load}
        onToast={onToast}
        account={editing}
      />
    </div>
  );
}