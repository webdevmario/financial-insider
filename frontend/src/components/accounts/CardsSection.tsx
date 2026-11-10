import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { fmt, fmtP, fmtDate } from "../../lib/formatters";
import CardForm from "./CardForm";
import type { CardAnalysis, CardResult, CreditCard, RewardUnit, StatementAccount } from "../../types";

interface CardsSectionProps {
  onToast: (msg: string, err?: boolean) => void;
}

const rateLabel = (rate: number, unit: RewardUnit) => (unit === "points" ? `${rate}x` : `${rate}%`);

/** Rewards in the card's own unit: dollars for cash back, points for points */
const earnedLabel = (earned: number, unit: RewardUnit) =>
  unit === "points" ? `${Math.round(earned).toLocaleString("en-US")} pts` : fmtP(earned);

function ratesSummary(card: CreditCard): string {
  const entries = Object.entries(card.rewardRates).sort((a, b) => b[1] - a[1]);
  const named = entries.filter(([k]) => k !== "*").map(([k, v]) => `${k} ${rateLabel(v, card.rewardUnit)}`);
  const other = card.rewardRates["*"];
  if (other != null) named.push(`Everything else ${rateLabel(other, card.rewardUnit)}`);
  return named.join(" · ");
}

export default function CardsSection({ onToast }: CardsSectionProps) {
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [analysis, setAnalysis] = useState<CardAnalysis | null>(null);
  const [accounts, setAccounts] = useState<StatementAccount[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CreditCard | null>(null);
  const [shownCard, setShownCard] = useState("");

  const load = useCallback(() => {
    return Promise.all([
      api.cards.list().then(setCards),
      api.cards.analysis().then(setAnalysis),
      api.transactions.accounts().then(setAccounts),
    ]).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const linked = (analysis?.cards ?? []).filter((c): c is Extract<CardResult, { linked: true }> => c.linked);
  const shown = linked.find((c) => c.id === shownCard) ?? linked[0];

  function openEdit(card: CreditCard | null) {
    setEditing(card);
    setFormOpen(true);
  }

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-[22px] font-semibold">Credit Cards</h2>
          <p className="text-[13px] text-text-dim mt-0.5">The cards in regular use, their reward rates, and what they earned on real spending</p>
        </div>
        <button className="btn btn-primary" onClick={() => openEdit(null)}>+ Add Card</button>
      </div>

      {cards.length === 0 ? (
        <div className="text-center py-10 text-text-dim bg-bg-card border border-border rounded-xl">
          <div className="text-4xl mb-3 opacity-40">💳</div>
          <p className="text-sm mb-4">No cards added yet.</p>
          <button className="btn btn-primary" onClick={() => openEdit(null)}>+ Add First Card</button>
        </div>
      ) : (
        <div className="grid grid-cols-3 max-lg:grid-cols-2 max-md:grid-cols-1 gap-5">
          {cards.map((c) => (
            <button
              key={c.id}
              onClick={() => openEdit(c)}
              className={`text-left bg-bg-card border border-border rounded-xl p-5 hover:border-[#363a50] hover:bg-bg-card-hover transition-colors ${c.inUse ? "" : "opacity-60"}`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{c.name}</div>
                  <div className="text-[11px] text-text-muted mt-0.5 truncate">
                    {[c.issuer, c.statementAccountId ? `Linked to ${accountName.get(c.statementAccountId) ?? c.statementAccountId}` : "Not linked to statements"]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!c.inUse && (
                    <span className="inline-flex px-2 py-0.5 rounded-xl text-[10px] font-semibold bg-white/[0.06] text-text-dim tracking-wide">
                      Not in use
                    </span>
                  )}
                  <span className="font-mono text-sm text-text-dim">{c.annualFee ? `${fmt(c.annualFee)}/yr` : "No fee"}</span>
                </div>
              </div>
              <div className="text-[12px] text-text-dim leading-relaxed">
                {ratesSummary(c) || <span className="text-text-muted">No reward rates yet</span>}
              </div>
              {c.benefits && <div className="text-[12px] text-text-muted mt-2 line-clamp-2 whitespace-pre-wrap">{c.benefits}</div>}
              <div className="mt-3 text-[10px] text-text-dim font-medium tracking-wide">
                {c.lastReviewed ? `Terms reviewed ${fmtDate(c.lastReviewed)}` : "Terms not reviewed yet"}
              </div>
            </button>
          ))}
        </div>
      )}

      {analysis && linked.length > 0 && (
        <>
          <div className="bg-bg-card border border-border rounded-xl p-6 max-md:p-5 mt-5">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
              <h3 className="text-[15px] font-semibold">Rewards on the last {analysis.months} months</h3>
              <span className="text-[11px] text-text-muted">
                {fmtDate(analysis.from)} – {fmtDate(analysis.to)}
              </span>
            </div>

            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm max-md:text-[13px]">
                <thead>
                  <tr className="text-[11px] font-semibold uppercase tracking-wider text-text-muted text-right">
                    <th className="text-left font-semibold pb-2">Card</th>
                    <th className="font-semibold pb-2 pl-3 max-md:pl-2 max-md:pl-2">Spending</th>
                    <th className="font-semibold pb-2 pl-3 max-md:pl-2 max-md:pl-2">Earned</th>
                    <th className="font-semibold pb-2 pl-3 max-md:pl-2 max-md:hidden">Annual fee</th>
                    <th className="font-semibold pb-2 pl-3 max-md:pl-2 max-md:hidden">Earned − fee</th>
                  </tr>
                </thead>
                <tbody>
                  {linked.map((c) => (
                    <tr key={c.id} className="border-t border-border/50 text-right">
                      <td className="text-left py-2.5">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-[11px] text-text-muted">
                          {c.feesAndInterest > 0 && <>Fees &amp; interest {fmtP(c.feesAndInterest)} · </>}
                          {c.rewardCredits !== 0 && <>Reward credits on statements {fmtP(c.rewardCredits)} · </>}
                          {c.firstDate ? `${fmtDate(c.firstDate)} – ${fmtDate(c.lastDate)}` : "No transactions in this window"}
                        </div>
                      </td>
                      <td className="font-mono py-2.5 pl-3 max-md:pl-2 max-md:pl-2">{fmt(c.spend)}</td>
                      <td className="font-mono py-2.5 pl-3 max-md:pl-2 max-md:pl-2">
                        <div className="text-green">{fmtP(c.value)}</div>
                        {c.rewardUnit === "points" && <div className="text-[11px] text-text-muted">{earnedLabel(c.earned, "points")}</div>}
                      </td>
                      <td className="font-mono py-2.5 pl-3 max-md:pl-2 max-md:hidden text-text-dim">{fmt(c.annualFee)}</td>
                      <td className={`font-mono py-2.5 pl-3 max-md:pl-2 max-md:hidden ${c.valueLessFee < 0 ? "text-red" : ""}`}>{fmtP(c.valueLessFee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-text-muted mt-3 leading-relaxed">
              Spending is purchases net of refunds. Fees and interest, and the Rewards category (cash-back redemptions and statement
              credits), are left out of what earns. Earned is spending × the rates stored on each card; points are valued at the
              card’s cents per point.
            </p>
          </div>

          {shown && (
            <div className="bg-bg-card border border-border rounded-xl p-6 max-md:p-5 mt-5">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <h3 className="text-[15px] font-semibold">Spending by category</h3>
                {linked.length > 1 && (
                  <select className="!w-auto !text-sm !py-1.5" value={shown.id} onChange={(e) => setShownCard(e.target.value)}>
                    {linked.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>
              {shown.categories.length === 0 ? (
                <p className="text-sm text-text-dim">No spending on this card in the window.</p>
              ) : (
                <div className="scroll-list max-h-[420px]">
                  <table className="w-full text-sm max-md:text-[13px]">
                    <thead>
                      <tr className="text-[11px] font-semibold uppercase tracking-wider text-text-muted text-right">
                        <th className="text-left font-semibold pb-2">Category</th>
                        <th className="font-semibold pb-2 pl-3 max-md:pl-2 max-md:pl-2">Spending</th>
                        <th className="font-semibold pb-2 pl-3 max-md:pl-2 max-md:pl-2">Rate</th>
                        <th className="font-semibold pb-2 pl-3 max-md:pl-2 max-md:pl-2">Earned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.categories.map((r) => (
                        <tr key={r.category} className="border-t border-border/50 text-right">
                          <td className="text-left py-2">{r.category}</td>
                          <td className="font-mono py-2 pl-3 max-md:pl-2 max-md:pl-2">{fmt(r.spend)}</td>
                          <td className="font-mono py-2 pl-3 max-md:pl-2 text-text-dim">{rateLabel(r.rate, shown.rewardUnit)}</td>
                          <td className="font-mono py-2 pl-3 max-md:pl-2 max-md:pl-2">{earnedLabel(r.earned, shown.rewardUnit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {analysis.byCategory.length > 0 && (
            <div className="bg-bg-card border border-border rounded-xl p-6 max-md:p-5 mt-5">
              <h3 className="text-[15px] font-semibold mb-1">Highest stored rate by category</h3>
              <p className="text-[12px] text-text-dim mb-4">
                Spending on all linked cards combined, what it earned on the cards it went on, and what the in-use card with the
                highest stored rate for that category would have earned on the same amount.
              </p>
              <div className="scroll-list max-h-[480px]">
                <table className="w-full text-sm max-md:text-[13px]">
                  <thead>
                    <tr className="text-[11px] font-semibold uppercase tracking-wider text-text-muted text-right">
                      <th className="text-left font-semibold pb-2">Category</th>
                      <th className="font-semibold pb-2 pl-3 max-md:pl-2 max-md:pl-2">Spending</th>
                      <th className="font-semibold pb-2 pl-3 max-md:pl-2 max-md:pl-2">Earned</th>
                      <th className="text-left font-semibold pb-2 pl-4 max-md:hidden">Highest rate</th>
                      <th className="font-semibold pb-2 pl-3 max-md:pl-2 max-md:pl-2">Would earn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.byCategory.map((r) => {
                      const diff = r.best ? r.best.value - r.actualValue : 0;
                      return (
                        <tr key={r.category} className="border-t border-border/50 text-right">
                          <td className="text-left py-2">
                            {r.category}
                            {r.best && (
                              <div className="md:hidden text-[11px] text-text-muted">
                                {r.best.name} {rateLabel(r.best.rate, r.best.rewardUnit)}
                              </div>
                            )}
                          </td>
                          <td className="font-mono py-2 pl-3 max-md:pl-2 max-md:pl-2">{fmt(r.spend)}</td>
                          <td className="font-mono py-2 pl-3 max-md:pl-2 max-md:pl-2">{fmtP(r.actualValue)}</td>
                          <td className="text-left py-2 pl-4 max-md:hidden">
                            {r.best ? (
                              <>
                                <span>{r.best.name}</span>{" "}
                                <span className="font-mono text-text-dim text-xs">{rateLabel(r.best.rate, r.best.rewardUnit)}</span>
                              </>
                            ) : (
                              <span className="text-text-muted">—</span>
                            )}
                          </td>
                          <td className="font-mono py-2 pl-3 max-md:pl-2 max-md:pl-2">
                            {r.best ? (
                              <>
                                <div>{fmtP(r.best.value)}</div>
                                {diff >= 0.01 && <div className="text-[11px] text-text-muted">+{fmtP(diff)}</div>}
                              </>
                            ) : (
                              <span className="text-text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <CardForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={load}
        onToast={onToast}
        card={editing}
        cards={cards}
        statementAccounts={accounts}
        categories={analysis?.categories ?? []}
      />
    </div>
  );
}
