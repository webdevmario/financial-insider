import { useState, useEffect } from "react";
import Modal from "../layout/Modal";
import { api } from "../../lib/api";
import { fmt, fmtDate } from "../../lib/formatters";
import type { Account, AccountType } from "../../types";
import { ACCOUNT_TYPES, OWNERS, INSTITUTIONS } from "../../types";

interface AccountFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, err?: boolean) => void;
  account?: Account | null;
}

export default function AccountForm({ open, onClose, onSaved, onToast, account }: AccountFormProps) {
  const [type, setType] = useState<AccountType>("Checking");
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
    } else {
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
    let bal: number;
    if (isHE) {
      bal = equityPreview;
    } else {
      bal = parseFloat(balance) || 0;
    }

    const payload: Partial<Account> = {
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
      } else {
        await api.accounts.create(payload);
        onToast("Added");
      }
      onSaved();
      onClose();
    } catch {
      onToast("Failed to save", true);
    }
  }

  async function handleDelete() {
    if (!account) return;
    try {
      await api.accounts.delete(account.id);
      onToast("Deleted");
      onSaved();
      onClose();
    } catch {
      onToast("Failed to delete", true);
    }
  }

  if (showConfirm) {
    const label = account ? `${account.type}${account.owner ? ` (${account.owner})` : ""}` : "";
    return (
      <Modal open={open} onClose={() => setShowConfirm(false)} title={`Delete "${label}"?`}>
        <p className="text-sm text-text-dim mb-6">This action cannot be undone.</p>
        <div className="flex justify-end gap-2.5 pt-4 border-t border-border">
          <button className="btn" onClick={() => setShowConfirm(false)}>Cancel</button>
          <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
        </div>
      </Modal>
    );
  }

  const titleExtra = account?.lastUpdated ? (
    <span className="relative group">
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border-[1.5px] border-text-muted text-text-muted text-[9px] font-bold cursor-default hover:border-accent hover:text-accent transition-all">
        i
      </span>
      <span className="absolute top-full left-1/2 -translate-x-1/2 mt-2.5 bg-[#1e2130] border border-border text-text-dim text-xs px-3 py-2.5 rounded-lg min-w-[160px] opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-[0_8px_24px_rgba(0,0,0,0.4)] z-20 whitespace-nowrap">
        Last updated {fmtDate(account.lastUpdated)}
      </span>
    </span>
  ) : undefined;

  return (
    <Modal open={open} onClose={onClose} title={account ? "Edit Asset" : "Add Asset"} titleExtra={titleExtra}>
      <div className="flex flex-col gap-4">
        {/* Type + Balance row */}
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <div className="input-group">
            <label>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          {!isHE && (
            <div className="input-group">
              <label>Value</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Home Equity fields */}
        {isHE && (
          <>
            <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
              <div className="input-group">
                <label>Home Value</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={homeValue}
                  onChange={(e) => setHomeValue(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label>Mortgage Balance</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={mortgageBalance}
                  onChange={(e) => setMortgageBalance(e.target.value)}
                />
              </div>
            </div>
            <div className="input-group">
              <label>Your Equity</label>
              <div className="font-mono px-3.5 py-2.5 rounded-lg bg-bg-input border border-border text-base font-semibold text-green">
                {fmt(equityPreview)}
              </div>
            </div>
          </>
        )}

        {/* Owner + Institution */}
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <div className="input-group">
            <label>Owner</label>
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              {OWNERS.map((o) => (
                <option key={o} value={o}>{o || "None"}</option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label>Held At</label>
            <select value={institution} onChange={(e) => setInstitution(e.target.value)}>
              {INSTITUTIONS.map((i) => (
                <option key={i} value={i}>{i || "None"}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Helper for Vehicle / Home Equity */}
        {(isVehicle || isHE) && (
          <div className="text-xs text-text-dim bg-bg-input rounded-lg px-3.5 py-2.5 leading-relaxed">
            {isHE ? (
              <>💡 Check value on <a href="https://www.zillow.com" target="_blank" rel="noreferrer" className="text-accent hover:underline">Zillow</a> or <a href="https://www.redfin.com" target="_blank" rel="noreferrer" className="text-accent hover:underline">Redfin</a>.</>
            ) : (
              <>💡 Check value at <a href="https://www.kbb.com/whats-my-car-worth/" target="_blank" rel="noreferrer" className="text-accent hover:underline">KBB.com</a></>
            )}
          </div>
        )}

        {/* Notes */}
        <div className="input-group">
          <label>Notes (optional)</label>
          <textarea
            rows={3}
            placeholder="Add context, reminders, or details..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2.5 pt-4 border-t border-border max-md:pb-[env(safe-area-inset-bottom)]">
          {account && (
            <button className="btn btn-danger btn-sm" onClick={() => setShowConfirm(true)}>
              🗑️ Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>
            {account ? "Update" : "Add"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
