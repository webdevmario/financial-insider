import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmt, fmtDate, fmtP } from "../../lib/formatters";
import { COST_LABELS, DOC_TYPE_LABELS, RUNNING_TYPES, carTitle, miles } from "../../lib/cars";
import Modal from "../layout/Modal";
import Segmented from "../layout/Segmented";
import type { CarDocument, VehicleDetail } from "../../types";

interface CarDetailProps {
  vehicleId: string | null;
  onClose: () => void;
  onEdit: () => void;
  onOpenDocument: (d: CarDocument) => void;
  onChanged: () => void;
  onToast: (msg: string, err?: boolean) => void;
  /** Bumped by the parent after anything changes, to reload */
  version: number;
}

type Tab = "costs" | "history" | "charges";

const SOURCE_LABEL = { charge: "Assigned", rule: "Shared", document: "Paid outside" } as const;

export default function CarDetail({ vehicleId, onClose, onEdit, onOpenDocument, onChanged, onToast, version }: CarDetailProps) {
  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  const [tab, setTab] = useState<Tab>("costs");

  const load = useCallback(() => {
    if (!vehicleId) return;
    api.cars.vehicle(vehicleId).then(setDetail).catch((err) => onToast(err instanceof Error ? err.message : "Failed to load", true));
  }, [vehicleId, onToast]);

  useEffect(() => {
    if (!vehicleId) {
      setDetail(null);
      setTab("costs");
      return;
    }
    load();
  }, [vehicleId, version, load]);

  async function unlink(linkId: string) {
    try {
      await api.cars.unlink(linkId);
      onToast("Charge unassigned");
      onChanged();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed", true);
    }
  }

  const s = detail?.summary;
  const v = s?.vehicle;
  const maxType = s ? Math.max(1, ...RUNNING_TYPES.map((t) => s.running[t] || 0), s.depreciation || 0) : 1;

  return (
    <Modal
      open={!!vehicleId}
      onClose={onClose}
      variant="detail"
      title={v?.name || "Car"}
      titleExtra={v && <span className="text-xs text-text-muted ml-2">{carTitle(v)}</span>}
      className="md:h-[min(760px,88vh)]"
      footer={<button className="btn" onClick={onEdit}>Edit car</button>}
    >
      {!s || !v ? (
        <div className="py-10 text-center text-text-muted text-sm">Loading…</div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-4 max-md:grid-cols-2 gap-3">
            <Figure label="Cost of ownership" value={fmt(s.ownershipCost)} hint={s.ownedYears != null ? `${s.ownedYears.toFixed(1)} years` : undefined} />
            <Figure label="Per year" value={s.perYear != null ? fmt(s.perYear) : "—"} hint={s.perMonth != null ? `${fmt(s.perMonth)}/mo` : undefined} />
            <Figure label="Per mile" value={s.costPerMile != null ? `$${s.costPerMile.toFixed(2)}` : "—"} hint={s.milesDriven ? `${miles(s.milesDriven)} driven` : "Needs odometer readings"} />
            <Figure
              label="Worth now"
              value={s.currentValue != null ? fmt(s.currentValue) : "—"}
              hint={s.valueSource === "asset" ? "From Assets" : s.valueSource === "sale" ? "Sold" : s.currentValueDate ? `As of ${fmtDate(s.currentValueDate)}` : "Add a value"}
            />
          </div>

          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            full
            options={[
              { value: "costs", label: "Costs" },
              { value: "history", label: `Service (${detail.documents.length})` },
              { value: "charges", label: `Charges (${detail.entries.length})` },
            ]}
          />

          {tab === "costs" && (
            <>
              <section>
                <Heading>Where the money went</Heading>
                <div className="flex flex-col gap-2">
                  {s.depreciation != null && (
                    <Bar label="Value lost (depreciation)" amount={s.depreciation} max={maxType} hint={`${fmt(v.purchasePrice)} → ${fmt(s.currentValue)}`} />
                  )}
                  {s.interest && (
                    <Bar label={`Loan interest${s.interest.estimated ? " (estimated)" : ""}`} amount={s.interest.amount} max={maxType} />
                  )}
                  {RUNNING_TYPES.filter((t) => s.running[t]).map((t) => (
                    <Bar key={t} label={COST_LABELS[t]} amount={s.running[t]!} max={maxType} />
                  ))}
                  {s.depreciation == null && (
                    <p className="text-[11px] text-text-muted">
                      Add the purchase price and a current value to count what the car has lost in value, usually the biggest cost.
                    </p>
                  )}
                  {s.paidTowardCar > 0 && (
                    <p className="text-[11px] text-text-muted">
                      {fmt(s.paidTowardCar)} in down payment and loan payments is counted through the price and interest above, not added again.
                    </p>
                  )}
                </div>
              </section>

              <section>
                <Heading>By year</Heading>
                {s.byYear.length === 0 ? (
                  <p className="text-xs text-text-muted">No running costs yet.</p>
                ) : (
                  <div className="bg-bg-input border border-border rounded-lg">
                    {s.byYear.map((y) => (
                      <div key={y.year} className="flex items-center justify-between gap-3 px-3.5 py-2 text-xs border-b border-border/40 last:border-0">
                        <span className="font-mono text-text-dim w-10 shrink-0">{y.year}</span>
                        <span className="flex-1 min-w-0 truncate text-text-muted">
                          {RUNNING_TYPES.filter((t) => y.byType[t]).map((t) => `${COST_LABELS[t]} ${fmt(y.byType[t])}`).join(" · ")}
                        </span>
                        <span className="font-mono shrink-0">{fmt(y.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-text-muted mt-2">
                  Repairs, maintenance and tires: {fmt(s.upkeepLast12)} in the last 12 months, {fmt(s.upkeepPrior12)} the 12 before.
                </p>
              </section>

              <section>
                <Heading>Mileage</Heading>
                {s.readings.length === 0 ? (
                  <p className="text-xs text-text-muted">No readings yet. Service invoices and the purchase mileage add them.</p>
                ) : (
                  <>
                    <p className="text-xs text-text-dim mb-2">
                      Last reading {miles(s.latestMiles)}
                      {s.milesPerYear ? ` · about ${s.milesPerYear.toLocaleString("en-US")} mi a year` : ""}
                      {s.estimatedMilesNow && s.estimatedMilesNow !== s.latestMiles ? ` · likely ${miles(s.estimatedMilesNow)} today` : ""}
                    </p>
                    <div className="bg-bg-input border border-border rounded-lg">
                      {[...s.readings].reverse().map((r, i) => (
                        <div key={i} className="flex justify-between gap-3 px-3.5 py-2 text-xs border-b border-border/40 last:border-0">
                          <span className="text-text-muted">{fmtDate(r.date)} · {r.source}</span>
                          <span className="font-mono">{miles(r.miles)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>
            </>
          )}

          {tab === "history" && (
            detail.documents.length === 0 ? (
              <p className="text-xs text-text-muted py-6 text-center">No documents for this car yet.</p>
            ) : (
              <div className="bg-bg-input border border-border rounded-lg">
                {detail.documents.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => onOpenDocument(d)}
                    className="w-full text-left flex items-start justify-between gap-3 px-3.5 py-2.5 text-xs border-b border-border/40 last:border-0 hover:bg-white/[0.03]"
                  >
                    <span className="min-w-0">
                      <span className="block text-text truncate">
                        {d.vendor || d.fileName}
                        {d.docType && <span className="text-text-muted"> · {DOC_TYPE_LABELS[d.docType]}</span>}
                      </span>
                      <span className="block text-text-muted truncate">
                        {[fmtDate(d.date), d.odometer != null ? miles(d.odometer) : null, d.summary].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {d.total != null && <span className="font-mono shrink-0">{fmtP(d.total)}</span>}
                  </button>
                ))}
              </div>
            )
          )}

          {tab === "charges" && (
            detail.entries.length === 0 ? (
              <p className="text-xs text-text-muted py-6 text-center">No charges assigned to this car yet.</p>
            ) : (
              <div className="bg-bg-input border border-border rounded-lg">
                {detail.entries.map((e, i) => (
                  <div key={`${e.transactionId || e.documentId}-${i}`} className="flex items-center justify-between gap-3 px-3.5 py-2 text-xs border-b border-border/40 last:border-0">
                    <span className="min-w-0">
                      <span className="block truncate">{e.description}</span>
                      <span className="text-text-muted">
                        {fmtDate(e.date)} · {COST_LABELS[e.costType]} · {SOURCE_LABEL[e.source]}
                        {e.share != null && e.share < 1 ? ` · ${Math.round(e.share * 100)}% share` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="font-mono">{fmtP(e.amount)}</span>
                      {e.linkId && (
                        <button className="text-text-muted hover:text-red text-[11px]" title="Unassign" onClick={() => unlink(e.linkId!)}>✕</button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}
    </Modal>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">{children}</div>;
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-bg-input border border-border rounded-lg px-3.5 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{label}</div>
      <div className="font-mono text-lg font-semibold mt-0.5">{value}</div>
      {hint && <div className="text-[11px] text-text-muted truncate">{hint}</div>}
    </div>
  );
}

function Bar({ label, amount, max, hint }: { label: string; amount: number; max: number; hint?: string }) {
  return (
    <div>
      <div className="flex justify-between gap-3 text-xs mb-1">
        <span className="text-text-dim">{label}{hint && <span className="text-text-muted"> · {hint}</span>}</span>
        <span className="font-mono">{fmt(amount)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(1, (Math.max(0, amount) / max) * 100)}%` }} />
      </div>
    </div>
  );
}
