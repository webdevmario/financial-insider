import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { fmt, fmtDate } from "../../lib/formatters";
import { Badge, Card, Empty } from "./shared";
import type { MergeMember } from "./MergeModal";
import type { Payee, PayeeSuggestion, UnassignedMerchant } from "../../types";

interface Props {
  payees: Payee[];
  version: number;
  onOpenPayee: (id: string) => void;
  onMerge: (members: MergeMember[], suggestedName?: string) => void;
  onToast: (msg: string, err?: boolean) => void;
}

export default function MerchantsTab({ payees, version, onOpenPayee, onMerge, onToast }: Props) {
  const [suggestions, setSuggestions] = useState<PayeeSuggestion[] | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedMerchant[] | null>(null);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qPayees, setQPayees] = useState("");
  const [qUnassigned, setQUnassigned] = useState("");

  useEffect(() => {
    api.payees.suggestions().then(setSuggestions).catch(() => setSuggestions([]));
    api.payees.unassigned().then(setUnassigned).catch(() => setUnassigned([]));
    setSelected(new Set());
  }, [version]);

  const filteredPayees = useMemo(
    () => payees.filter((p) => !qPayees || p.name.toLowerCase().includes(qPayees.toLowerCase()) || p.aliases.some((a) => a.pattern.toLowerCase().includes(qPayees.toLowerCase()))),
    [payees, qPayees]
  );
  const filteredUnassigned = useMemo(
    () => (unassigned ?? []).filter((u) => !qUnassigned || u.merchant.toLowerCase().includes(qUnassigned.toLowerCase()) || u.samples.some((s) => s.toLowerCase().includes(qUnassigned.toLowerCase()))),
    [unassigned, qUnassigned]
  );

  function toggle(key: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function dismiss(s: PayeeSuggestion) {
    try {
      await api.payees.dismissSuggestion(s.id);
      setSuggestions((list) => list?.filter((x) => x.id !== s.id) ?? null);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed", true);
    }
  }

  const shownSuggestions = showAllSuggestions ? suggestions ?? [] : (suggestions ?? []).slice(0, 4);
  const assignedShare = useMemo(() => {
    const assigned = payees.reduce((s, p) => s + p.spent, 0);
    const rest = (unassigned ?? []).reduce((s, u) => s + u.spent, 0);
    if (assigned + rest <= 0) return "0%";
    const pct = (assigned / (assigned + rest)) * 100;
    return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
  }, [payees, unassigned]);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-text-muted -mb-1">
        A payee is the one name you want to see for a merchant, however it shows up on statements. Group bank names under
        a payee here, or from any transaction. {payees.length > 0 && <>Payees cover <span className="text-text">{assignedShare}</span> of your spending so far.</>}
      </p>

      {suggestions && suggestions.length > 0 && (
        <Card
          title={`Suggested groups (${suggestions.length})`}
          extra={suggestions.length > 4 && (
            <button className="text-xs text-accent" onClick={() => setShowAllSuggestions((v) => !v)}>
              {showAllSuggestions ? "Show fewer" : "Show all"}
            </button>
          )}
        >
          <div className="flex flex-col gap-3">
            {shownSuggestions.map((s) => (
              <div key={s.id} className="border border-border rounded-lg p-3">
                <div className="text-[11px] text-text-muted mb-2">{s.reason}</div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {s.members.map((m) => (
                    <span key={m.key} className={`text-xs px-2 py-0.5 rounded-md border ${m.payeeId ? "border-accent/40 text-accent" : "border-border text-text-dim"}`}>
                      {m.name} <span className="text-text-muted">· {m.count}× · {fmt(m.spent)}</span>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 justify-end">
                  <button className="btn btn-sm" onClick={() => dismiss(s)}>Not the same</button>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => onMerge(s.members.map((m) => ({ key: m.key, name: m.name, count: m.count, spent: m.spent })), s.name)}
                  >
                    Group…
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-5">
        <Card title={`Payees (${payees.length})`}>
          <input placeholder="Search payees and aliases" value={qPayees} onChange={(e) => setQPayees(e.target.value)} className="!text-sm !py-1.5 mb-2" />
          {filteredPayees.length === 0 ? (
            <Empty>{payees.length ? "No match." : "No payees yet. Group a suggestion or pick bank names under No payee yet."}</Empty>
          ) : (
            <div className="flex flex-col max-h-[520px] overflow-y-auto">
              {filteredPayees.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onOpenPayee(p.id)}
                  className="flex items-center gap-3 text-left py-2 px-1 border-b border-border/30 last:border-0 hover:bg-white/[0.02]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm truncate">{p.name}</span>
                      {p.billId && <Badge className="bg-white/[0.06] text-text-dim">Bill</Badge>}
                    </div>
                    <div className="text-[11px] text-text-muted truncate">
                      {p.category ?? "Bank category"} · {p.aliases.length} alias{p.aliases.length === 1 ? "" : "es"} · {p.count}×
                      {p.lastDate && <> · last {fmtDate(p.lastDate)}</>}
                    </div>
                  </div>
                  <span className="font-mono text-xs shrink-0">{fmt(p.spent)}</span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card
          title={`No payee yet (${unassigned?.length ?? "…"})`}
          extra={selected.size > 0 && (
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                const members = (unassigned ?? []).filter((u) => selected.has(u.key)).map((u) => ({ key: `m:${u.key}`, name: u.merchant, count: u.count, spent: u.spent }));
                onMerge(members);
              }}
            >
              {selected.size === 1 ? "Name it…" : `Group ${selected.size}…`}
            </button>
          )}
        >
          <input placeholder="Search bank names" value={qUnassigned} onChange={(e) => setQUnassigned(e.target.value)} className="!text-sm !py-1.5 mb-2" />
          {unassigned === null ? (
            <Empty>Loading…</Empty>
          ) : filteredUnassigned.length === 0 ? (
            <Empty>{unassigned.length ? "No match." : "Everything has a payee."}</Empty>
          ) : (
            <div className="flex flex-col max-h-[520px] overflow-y-auto">
              {filteredUnassigned.slice(0, 300).map((u) => (
                <label key={u.key} className="flex items-center gap-3 py-2 px-1 border-b border-border/30 last:border-0 cursor-pointer hover:bg-white/[0.02]">
                  <input type="checkbox" checked={selected.has(u.key)} onChange={() => toggle(u.key)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{u.merchant}</div>
                    <div className="text-[11px] text-text-muted truncate font-mono" title={u.samples.join("\n")}>{u.samples[0]}</div>
                  </div>
                  <span className="text-right shrink-0">
                    <span className="block font-mono text-xs">{fmt(u.spent)}</span>
                    <span className="block text-[10px] text-text-muted">{u.count}×</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {selected.size > 0 && (
            <button className="text-[11px] text-text-muted mt-2 hover:text-text" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          )}
        </Card>
      </div>
    </div>
  );
}
