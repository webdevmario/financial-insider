import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmt, fmtDate, fmtP } from "../../lib/formatters";
import { CLASS_LABELS, KIND_LABELS, ROLE_LABELS, STATUS_CHIP, STATUS_LABELS, fmtShares, pct1 } from "../../lib/investments";
import StatCard from "../layout/StatCard";
import LoadingState from "../layout/LoadingState";
import Segmented from "../layout/Segmented";
import SecurityForm from "./SecurityForm";
import SnapshotModal, { type SnapshotStart } from "./SnapshotModal";
import TargetsForm from "./TargetsForm";
import type { HoldingsAccount, HoldingsMeta, HoldingsOverview, Security } from "../../types";

interface InvestmentsViewProps {
  onToast: (msg: string, err?: boolean) => void;
}

type ListFilter = "held" | "watch" | "remove" | "all";

export default function InvestmentsView({ onToast }: InvestmentsViewProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<HoldingsOverview | null>(null);
  const [meta, setMeta] = useState<HoldingsMeta | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotStart | null>(null);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [editingSecurity, setEditingSecurity] = useState<Security | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [filter, setFilter] = useState<ListFilter>("held");

  const load = useCallback(() => {
    return Promise.all([api.holdings.overview(), api.holdings.meta()])
      .then(([o, m]) => {
        setData(o);
        setMeta(m);
      })
      .catch((err) => onToast(err instanceof Error ? err.message : "Failed to load investments", true));
  }, [onToast]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  if (loading || !data || !meta) return <LoadingState />;

  const intl = data.byClass.find((c) => c.assetClass === "intl_stock");
  const list = data.securities.filter((s) =>
    filter === "all" ? true : filter === "held" ? s.held : s.status === filter
  );
  const openSecurity = (s: Security | null) => {
    setEditingSecurity(s);
    setSecurityOpen(true);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-[22px] font-semibold">Investments</h2>
          <p className="text-xs text-text-muted mt-0.5">
            {data.asOf ? `What each account held, as typed on the 1st. Latest: ${fmtDate(data.asOf)}.` : "What each account holds, typed in on the 1st. No live prices."}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn" onClick={() => setTargetsOpen(true)}>Targets</button>
          <button className="btn" onClick={() => openSecurity(null)}>+ Add to list</button>
          <button className="btn btn-primary" onClick={() => setSnapshot({ accountId: null, asOf: null, edit: false })}>+ New snapshot</button>
        </div>
      </div>

      {data.accounts.length === 0 ? (
        <div className="text-center py-12 text-text-dim bg-bg-card border border-border rounded-xl mb-6">
          <div className="text-4xl mb-3 opacity-40">💼</div>
          <p className="text-sm mb-1">No holdings yet.</p>
          <p className="text-xs text-text-muted mb-4 max-w-md mx-auto">
            On the 1st, open each broker and add a snapshot: every fund, stock and cash line with its shares and value.
            The list of securities builds itself as you go; then mark each one keep, watch or remove and say why.
          </p>
          <button className="btn btn-primary" onClick={() => setSnapshot({ accountId: null, asOf: null, edit: false })}>+ First snapshot</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 max-md:grid-cols-1 gap-5 mb-6">
            <StatCard label="Invested" value={fmt(data.total)} color="blue" />
            <StatCard label={`International (target ${data.targets.intlPct}%)`} value={pct1(intl?.pct ?? 0)} color="purple" />
            <StatCard label={`Play money (cap ${data.targets.playCapPct}%)`} value={pct1(data.playPct)} color="amber" />
          </div>

          {data.flags.length > 0 && (
            <Section title="Worth a look" hint="Flags only. Rebalancing waits for the January review, new money first.">
              <ul className="flex flex-col gap-1.5">
                {data.flags.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px]">
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${f.level === "warn" ? "bg-amber" : "bg-text-muted"}`} />
                    <span className={f.level === "warn" ? "text-text" : "text-text-dim"}>{f.message}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Mix vs target" hint={`Whole household, every account's latest snapshot. Bands are target ± ${data.targets.bandPts} points.`}>
            <div className="flex flex-col gap-3">
              {data.byClass.map((c) => (
                <MixBar key={c.assetClass} label={c.label} pct={c.pct} value={c.value} low={c.low} high={c.high} target={c.targetPct} state={c.state} />
              ))}
              <MixBar
                label="Play money"
                pct={data.playPct}
                value={data.play}
                low={null}
                high={data.targets.playCapPct}
                target={null}
                state={data.play > data.playCap ? "high" : "ok"}
                note={`${fmt(data.playRoom)} of room under the ${fmt(data.playCap)} cap`}
              />
            </div>
            <p className="text-[11px] text-text-muted mt-4">
              Fund fees:{" "}
              {data.fees.blendedPct != null ? (
                <>
                  <span className="font-mono text-text">{data.fees.blendedPct}%</span> blended, about{" "}
                  <span className="font-mono text-text">{fmt(data.fees.yearlyDollars)}</span> a year on {fmt(data.fees.coveredValue)}
                </>
              ) : (
                "add expense ratios on the list below to see them"
              )}
              {data.fees.fundsMissingRatio.length > 0 && <>. Missing: {data.fees.fundsMissingRatio.join(", ")}</>}
            </p>
          </Section>

          <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-5 mb-6">
            {data.accounts.map((a) => (
              <AccountCard
                key={a.accountId}
                a={a}
                onUpdate={() => setSnapshot({ accountId: a.accountId, asOf: null, edit: false })}
                onEdit={() => setSnapshot({ accountId: a.accountId, asOf: a.asOf, edit: true })}
              />
            ))}
          </div>

          {data.history.length > 1 && (
            <Section title="Snapshots over time" hint="Each date uses every account's latest snapshot up to that day.">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-muted text-left">
                      <th className="font-medium py-1.5 pr-3">As of</th>
                      <th className="font-medium py-1.5 pr-3 text-right">Invested</th>
                      <th className="font-medium py-1.5 pr-3 text-right">US</th>
                      <th className="font-medium py-1.5 pr-3 text-right">International</th>
                      <th className="font-medium py-1.5 text-right">Play money</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.history].reverse().map((h) => (
                      <tr key={h.asOf} className="border-t border-border/40">
                        <td className="py-1.5 pr-3">{fmtDate(h.asOf)}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{fmt(h.total)}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{pct1(h.usPct)}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{pct1(h.intlPct)}</td>
                        <td className="py-1.5 text-right font-mono">{fmt(h.play)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </>
      )}

      <Section
        title="Our list"
        hint="Everything we hold or have decided about. Keep, watch or remove is our call, with one line on why."
        extra={<button className="btn btn-sm" onClick={() => openSecurity(null)}>+ Add</button>}
      >
        <Segmented<ListFilter>
          value={filter}
          onChange={setFilter}
          className="mb-3"
          options={[
            { value: "held", label: `Held (${data.securities.filter((s) => s.held).length})` },
            { value: "watch", label: `Watch (${data.securities.filter((s) => s.status === "watch").length})` },
            { value: "remove", label: `Remove (${data.securities.filter((s) => s.status === "remove").length})` },
            { value: "all", label: `All (${data.securities.length})` },
          ]}
        />
        {list.length === 0 ? (
          <p className="text-xs text-text-muted py-3">
            {data.securities.length === 0 ? "Nothing yet. It fills in from your first snapshot, or add one by hand." : "None."}
          </p>
        ) : (
          <div className="bg-bg-input border border-border rounded-lg max-h-[520px] overflow-y-auto">
            {list.map((s) => (
              <button
                key={s.id}
                className="w-full text-left flex items-center gap-3 px-3.5 py-2.5 border-b border-border/40 last:border-0 hover:bg-white/[0.03]"
                onClick={() => openSecurity(s)}
              >
                <span className="font-mono text-[13px] font-semibold w-24 shrink-0 truncate">{s.symbol}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] truncate">{s.name || <span className="text-text-muted">No name yet</span>}</span>
                  <span className="block text-[11px] text-text-muted truncate">
                    {[
                      CLASS_LABELS[s.assetClass],
                      KIND_LABELS[s.kind],
                      (s.held ? s.heldAs : [s.role]).map((r) => ROLE_LABELS[r]).join(" and "),
                      s.expenseRatio != null ? `${s.expenseRatio}% a year` : null,
                      s.why,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block font-mono text-xs">{s.held ? fmt(s.value) : "not held"}</span>
                  {s.held && <span className="block text-[10px] text-text-muted">{pct1(s.pct)}</span>}
                </span>
                <span className={`shrink-0 px-2 py-0.5 rounded-2xl text-[10px] font-semibold ${STATUS_CHIP[s.status]}`}>
                  {STATUS_LABELS[s.status]}
                </span>
              </button>
            ))}
          </div>
        )}
      </Section>

      <SnapshotModal
        start={snapshot}
        onClose={() => setSnapshot(null)}
        onSaved={load}
        onToast={onToast}
        accounts={meta.accounts}
        securities={data.securities}
      />
      <SecurityForm open={securityOpen} onClose={() => setSecurityOpen(false)} onSaved={load} onToast={onToast} security={editingSecurity} />
      <TargetsForm open={targetsOpen} onClose={() => setTargetsOpen(false)} onSaved={load} onToast={onToast} targets={data.targets} />
    </div>
  );
}

function MixBar({ label, pct, value, low, high, target, state, note }: {
  label: string; pct: number; value: number; low: number | null; high: number | null; target: number | null;
  state: "low" | "high" | "ok" | null; note?: string;
}) {
  const scale = Math.max(100, high ?? 0);
  const off = state === "low" || state === "high";
  return (
    <div className="text-xs">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span>{label}</span>
        <span className="text-text-muted">
          <span className={`font-mono ${off ? "text-amber" : "text-text"}`}>{pct1(pct)}</span>
          {target != null && <> · target {target}% ({low} to {high})</>}
          {target == null && high != null && <> · cap {high}%</>}
          {" · "}<span className="font-mono">{fmt(value)}</span>
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-white/[0.05] overflow-hidden">
        {low != null && high != null && (
          <div className="absolute inset-y-0 bg-white/[0.08]" style={{ left: `${(low / scale) * 100}%`, width: `${((high - low) / scale) * 100}%` }} />
        )}
        {low == null && high != null && (
          <div className="absolute inset-y-0 w-px bg-text-muted" style={{ left: `${(high / scale) * 100}%` }} />
        )}
        <div className={`relative h-full rounded-full ${off ? "bg-amber" : "bg-accent"}`} style={{ width: `${Math.min(100, (pct / scale) * 100)}%` }} />
      </div>
      {note && <div className="text-[11px] text-text-muted mt-1">{note}</div>}
    </div>
  );
}

function AccountCard({ a, onUpdate, onEdit }: { a: HoldingsAccount; onUpdate: () => void; onEdit: () => void }) {
  const diff = a.balance != null ? a.total - a.balance : null;
  return (
    <div className="bg-bg-card border border-border rounded-xl p-5 max-md:p-4">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <div className="font-semibold truncate">{a.label}</div>
          <div className="text-[11px] text-text-muted mt-0.5">
            As of {fmtDate(a.asOf)}
            {a.snapshotDates.length > 1 && ` · ${a.snapshotDates.length} snapshots`}
          </div>
        </div>
        <span className="font-mono text-lg font-semibold shrink-0">{fmtP(a.total)}</span>
      </div>
      {diff != null && Math.abs(diff) >= 1 && (
        <div className="text-[11px] text-text-muted mb-2">
          Assets page says {fmtP(a.balance)}{a.balanceUpdated ? ` (${fmtDate(a.balanceUpdated)})` : ""}
        </div>
      )}
      <div className="overflow-x-auto mt-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-muted text-left">
              <th className="font-medium py-1 pr-2">Holding</th>
              <th className="font-medium py-1 pr-2 text-right">Shares</th>
              <th className="font-medium py-1 pr-2 text-right">Value</th>
              <th className="font-medium py-1 pr-2 text-right">Share</th>
              <th className="font-medium py-1 text-right">Gain</th>
            </tr>
          </thead>
          <tbody>
            {a.rows.map((r) => (
              <tr key={r.holdingId} className="border-t border-border/40">
                <td className="py-1.5 pr-2">
                  <span className="font-mono font-semibold">{r.symbol}</span>
                  {r.role === "play" && <span className="ml-1.5 px-1.5 py-px rounded text-[9px] font-semibold bg-amber/[0.12] text-amber">PLAY</span>}
                  {r.status !== "keep" && (
                    <span className={`ml-1.5 px-1.5 py-px rounded text-[9px] font-semibold ${STATUS_CHIP[r.status]}`}>{STATUS_LABELS[r.status].toUpperCase()}</span>
                  )}
                </td>
                <td className="py-1.5 pr-2 text-right font-mono text-text-dim">{fmtShares(r.shares)}</td>
                <td className="py-1.5 pr-2 text-right font-mono">{fmtP(r.value)}</td>
                <td className="py-1.5 pr-2 text-right font-mono text-text-dim">{pct1(r.pctOfAccount)}</td>
                <td className={`py-1.5 text-right font-mono ${r.gain == null ? "text-text-muted" : r.gain >= 0 ? "text-green" : "text-red"}`}>
                  {r.gain == null ? "—" : `${r.gain >= 0 ? "+" : ""}${fmt(r.gain)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 mt-4">
        <button className="btn btn-sm btn-primary" onClick={onUpdate}>New snapshot</button>
        <button className="btn btn-sm" onClick={onEdit}>Edit this one</button>
      </div>
    </div>
  );
}

function Section({ title, hint, extra, children }: { title: string; hint?: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 max-md:p-4 mb-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{title}</h3>
          {hint && <p className="text-[11px] text-text-muted mt-0.5 break-words">{hint}</p>}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}
