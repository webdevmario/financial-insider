import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmt, fmtDate, fmtP } from "../../lib/formatters";
import { COST_LABELS, DOC_TYPE_LABELS, carTitle, miles } from "../../lib/cars";
import StatCard from "../layout/StatCard";
import LoadingState from "../layout/LoadingState";
import Segmented from "../layout/Segmented";
import CarForm from "./CarForm";
import CarDetail from "./CarDetail";
import DocumentModal from "./DocumentModal";
import AssignModal from "./AssignModal";
import UpgradeCalculator from "./UpgradeCalculator";
import type { Account, CarDocument, CarGaps, CarRule, CarsOverview, Vehicle, VehicleSummary } from "../../types";

interface CarsViewProps {
  onToast: (msg: string, err?: boolean) => void;
}

type GapTab = "unassigned" | "receipts" | "documents";
type DocFilter = "new" | "done" | "skipped";

export default function CarsView({ onToast }: CarsViewProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CarsOverview | null>(null);
  const [docs, setDocs] = useState<CarDocument[]>([]);
  const [rules, setRules] = useState<CarRule[]>([]);
  const [assets, setAssets] = useState<Account[]>([]);
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<CarDocument | null>(null);
  const [assign, setAssign] = useState<{ group: CarGaps["unassigned"][number] } | { rule: CarRule } | null>(null);
  const [gapTab, setGapTab] = useState<GapTab>("unassigned");
  const [docFilter, setDocFilter] = useState<DocFilter>("new");

  const load = useCallback(() => {
    return Promise.all([api.cars.overview(), api.cars.documents(), api.cars.rules(), api.cars.meta()])
      .then(([overview, d, r, meta]) => {
        setData(overview);
        setDocs(d);
        setRules(r);
        setAssets(meta.vehicleAssets);
        setScanUrl(meta.scanUrl);
      })
      .catch((err) => onToast(err instanceof Error ? err.message : "Failed to load cars", true));
  }, [onToast]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  /** "+2 supporting" for a document with supporting documents (they're listed inside it, not on their own) */
  const supportCount = (id: string) => {
    const n = docs.filter((d) => d.parentId === id).length;
    return n ? `+${n} supporting` : null;
  };

  const changed = useCallback(() => {
    setVersion((v) => v + 1);
    load();
  }, [load]);

  async function scan() {
    try {
      const r = await api.cars.scan();
      onToast(r.added ? `${r.added} new document${r.added === 1 ? "" : "s"} from Papers` : "Nothing new in Papers");
      changed();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Scan failed", true);
    }
  }

  if (loading || !data) return <LoadingState />;

  const cars = data.vehicles.map((s) => s.vehicle);
  const carName = (id: string | null) => cars.find((c) => c.id === id)?.name;
  const { household, gaps } = data;
  const shownDocs = docs.filter((d) => d.status === docFilter);
  const unread = docs.filter((d) => d.status === "new").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h2 className="text-[22px] font-semibold">Cars</h2>
        <div className="flex gap-2">
          {scanUrl && (
            // Documents live in Papers: scanning there files them under Cars, and they show up here as new
            <a className="btn" href={`${scanUrl}&return=${encodeURIComponent(location.href)}`}>Add document</a>
          )}
          <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>+ Add Car</button>
        </div>
      </div>

      <div className="grid grid-cols-3 max-md:grid-cols-1 gap-5 mb-6">
        <StatCard label="Spent running the cars" value={fmt(household.runningTotal)} color="blue" />
        <StatCard label="Last 12 months" value={fmt(household.runningLast12)} color="amber" />
        <StatCard label="Total cost of ownership" value={fmt(household.ownershipTotal)} color="purple" />
      </div>

      {unread > 0 && (
        <div className="mb-6 rounded-xl border border-accent/30 bg-accent/[0.06] px-5 py-4 text-sm flex items-start justify-between gap-4 flex-wrap">
          <div>
            <b>{unread} document{unread === 1 ? "" : "s"}</b> waiting to be read.
            <div className="text-xs text-text-dim mt-1">
              Run <code className="font-mono text-text">/car-docs</code> in Claude Code to read them, or open one below to fill it in by hand.
            </div>
          </div>
          <button className="btn btn-sm" onClick={() => { setDocFilter("new"); document.getElementById("car-docs")?.scrollIntoView({ behavior: "smooth" }); }}>
            Show them
          </button>
        </div>
      )}

      {cars.length === 0 ? (
        <div className="text-center py-12 text-text-dim bg-bg-card border border-border rounded-xl mb-6">
          <div className="text-4xl mb-3 opacity-40">🚗</div>
          <p className="text-sm mb-1">No cars yet.</p>
          <p className="text-xs text-text-muted mb-4 max-w-md mx-auto">
            Add your cars, then scan receipts, invoices, bills of sale and insurance pages in Papers, under Cars.
            {household.unassignedTotal > 0 && ` ${fmt(household.unassignedTotal)} in car charges is already in your bank data, waiting to be assigned.`}
          </p>
          <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>+ Add First Car</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4 mb-6">
          {data.vehicles.map((s) => <CarCard key={s.vehicle.id} s={s} onOpen={() => setDetailId(s.vehicle.id)} />)}
        </div>
      )}

      {household.byYear.length > 0 && (
        <Section title="Running costs by year" hint="Gas, insurance, repairs, maintenance, registration and parking assigned to a car. Purchases and loans aren't included.">
          <YearBars rows={household.byYear} />
        </Section>
      )}

      <Section title="Fill the gaps" hint="What's missing for a complete picture.">
        <Segmented<GapTab>
          value={gapTab}
          onChange={setGapTab}
          className="mb-3"
          options={[
            { value: "unassigned", label: <>Unassigned <Count n={gaps.unassigned.length} /></> },
            { value: "receipts", label: <>No receipt <Count n={gaps.missingReceipts.length} /></> },
            { value: "documents", label: <>No charge <Count n={gaps.unmatchedDocuments.length} /></> },
          ]}
        />
        {gapTab === "unassigned" && (
          gaps.unassigned.length === 0 ? (
            <Empty>Every Auto and Gas charge is assigned to a car.</Empty>
          ) : (
            <>
              <p className="text-xs text-text-muted mb-2">
                {fmt(gaps.unassignedTotal)} in Auto and Gas charges isn't counted toward any car yet.
                {cars.length === 0 && " Add your cars first."}
              </p>
              <List>
                {gaps.unassigned.map((g) => (
                  <Row
                    key={g.payeeId || g.merchant}
                    title={g.merchant}
                    sub={`${g.count} charge${g.count === 1 ? "" : "s"} · ${fmtDate(g.first)} – ${fmtDate(g.last)}`}
                    amount={fmtP(g.total)}
                    action={cars.length ? "Assign" : undefined}
                    onClick={cars.length ? () => setAssign({ group: g }) : undefined}
                  />
                ))}
              </List>
            </>
          )
        )}
        {gapTab === "receipts" && (
          gaps.missingReceipts.length === 0 ? (
            <Empty>Every car charge over $100 has a document.</Empty>
          ) : (
            <>
              <p className="text-xs text-text-muted mb-2">Car charges over $100 with no invoice or receipt. Shops can usually email old invoices.</p>
              <List>
                {gaps.missingReceipts.map((m) => (
                  <Row
                    key={m.transactionId}
                    title={m.merchant}
                    sub={[fmtDate(m.date), carName(m.vehicleId)].filter(Boolean).join(" · ")}
                    amount={fmtP(m.amount)}
                  />
                ))}
              </List>
            </>
          )
        )}
        {gapTab === "documents" && (
          gaps.unmatchedDocuments.length === 0 ? (
            <Empty>Every read document is matched to a bank charge or marked as paid outside.</Empty>
          ) : (
            <List>
              {gaps.unmatchedDocuments.map((d) => (
                <Row
                  key={d.id}
                  title={d.vendor || "Document"}
                  sub={[fmtDate(d.date), carName(d.vehicleId)].filter(Boolean).join(" · ")}
                  amount={fmtP(d.total)}
                  action="Match"
                  onClick={() => setOpenDoc(docs.find((x) => x.id === d.id) || null)}
                />
              ))}
            </List>
          )
        )}
      </Section>

      <Section title="Documents" hint="Documents filed under Cars in Papers." id="car-docs"
        extra={<button className="btn btn-sm" onClick={scan}>Check Papers</button>}>
        <Segmented<DocFilter>
          value={docFilter}
          onChange={setDocFilter}
          className="mb-3"
          options={[
            { value: "new", label: `To read (${unread})` },
            { value: "done", label: `Read (${docs.filter((d) => d.status === "done" && !d.parentId).length})` },
            { value: "skipped", label: "Skipped" },
          ]}
        />
        {shownDocs.length === 0 ? (
          <Empty>{docFilter === "new" ? "Nothing waiting. Documents filed under Cars in Papers show up here." : "None."}</Empty>
        ) : (
          <List>
            {shownDocs.filter((d) => !d.parentId || !shownDocs.some((m) => m.id === d.parentId)).map((d) => (
              <Row
                key={d.id}
                title={d.status === "new" ? d.fileName : d.vendor || d.fileName}
                sub={
                  d.status === "new"
                    ? `Added ${fmtDate(d.addedAt.slice(0, 10))}`
                    : [fmtDate(d.date), d.docType ? DOC_TYPE_LABELS[d.docType] : null, carName(d.vehicleId), d.odometer != null ? miles(d.odometer) : null,
                      supportCount(d.id)]
                        .filter(Boolean).join(" · ")
                }
                amount={d.total != null ? fmtP(d.total) : undefined}
                onClick={() => setOpenDoc(d)}
              />
            ))}
          </List>
        )}
      </Section>

      <Section title="Shared costs" hint="Rules that split charges across cars, like gas or a policy covering both cars.">
        {rules.length === 0 ? (
          <Empty>None yet. Assign a merchant above and pick “Split evenly” to make one.</Empty>
        ) : (
          <List>
            {rules.map((r) => (
              <Row
                key={r.id}
                title={r.notes || r.matchValue}
                sub={`${r.matchType === "category" ? "Category" : "Merchant"} · ${COST_LABELS[r.costType]} · ${
                  !r.shares ? "split evenly" : Object.keys(r.shares).length === 1 ? carName(Object.keys(r.shares)[0]) || "one car"
                    : Object.entries(r.shares).map(([id, w]) => `${carName(id) || "?"} ${w}`).join(" / ")
                }${r.dateFrom || r.dateTo ? ` · ${fmtDate(r.dateFrom) || "start"} – ${fmtDate(r.dateTo) || "now"}` : ""}`}
                action="Edit"
                onClick={() => setAssign({ rule: r })}
              />
            ))}
          </List>
        )}
      </Section>

      <Section title="Keep or upgrade" hint="Your numbers and assumptions side by side. Change any input.">
        <UpgradeCalculator cars={data.vehicles} context={data.context} />
      </Section>

      <CarForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={changed} onToast={onToast} car={editing} assets={assets} />
      <CarDetail
        vehicleId={detailId}
        version={version}
        onClose={() => setDetailId(null)}
        onEdit={() => { setEditing(cars.find((c) => c.id === detailId) || null); setFormOpen(true); }}
        onOpenDocument={setOpenDoc}
        onChanged={changed}
        onToast={onToast}
      />
      <DocumentModal doc={openDoc} cars={cars} docs={docs} onOpen={setOpenDoc} onClose={() => setOpenDoc(null)} onSaved={changed} onToast={onToast} />
      <AssignModal target={assign} cars={cars} onClose={() => setAssign(null)} onSaved={changed} onToast={onToast} />
    </div>
  );
}

function CarCard({ s, onOpen }: { s: VehicleSummary; onOpen: () => void }) {
  const v = s.vehicle;
  const trend = s.upkeepPrior12 > 0 ? (s.upkeepLast12 - s.upkeepPrior12) / s.upkeepPrior12 : null;
  return (
    <button onClick={onOpen} className="text-left bg-bg-card border border-border rounded-xl p-5 hover:border-[#363a50] transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="font-semibold truncate">{v.name}</div>
          <div className="text-[11px] text-text-muted mt-0.5 truncate">
            {[carTitle(v), v.purchaseDate ? `since ${fmtDate(v.purchaseDate)}` : null].filter(Boolean).join(" · ")}
          </div>
        </div>
        {v.soldDate ? (
          <span className="shrink-0 px-2 py-0.5 rounded-2xl text-[10px] font-semibold bg-white/[0.06] text-text-muted">Sold {v.soldDate.slice(0, 4)}</span>
        ) : s.lastService ? (
          <span className="shrink-0 text-[10px] text-text-muted text-right">Last service<br />{fmtDate(s.lastService.date)}</span>
        ) : null}
      </div>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <span className="font-mono text-[22px] font-semibold tracking-tight">{fmt(s.ownershipCost)}</span>
        <span className="text-xs text-text-muted">
          {s.perYear != null ? <><span className="font-mono text-text">{fmt(s.perYear)}</span>/yr</> : "cost so far"}
          {s.costPerMile != null && <> · <span className="font-mono text-text">${s.costPerMile.toFixed(2)}</span>/mi</>}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <Mini label="Running" value={fmt(s.runningTotal)} />
        <Mini label="Value lost" value={s.depreciation != null ? fmt(s.depreciation) : "—"} />
        <Mini
          label={s.milesPerYear || v.soldDate ? "Miles" : "Last reading"}
          value={
            s.estimatedMilesNow == null ? "—"
              : `${Math.round(s.estimatedMilesNow / 1000)}k${!s.milesPerYear && !v.soldDate && s.readings.length ? ` (${s.readings[s.readings.length - 1].date.slice(0, 4)})` : ""}`
          }
        />
      </div>
      <div className="text-[11px] text-text-muted mt-3">
        Repairs last 12 months <span className="font-mono text-text">{fmt(s.upkeepLast12)}</span>
        {trend != null && (
          <span className={trend > 0.15 ? "text-amber" : trend < -0.15 ? "text-green" : ""}>
            {" "}({trend >= 0 ? "+" : ""}{Math.round(trend * 100)}% vs the year before)
          </span>
        )}
        {s.documents > 0 && <> · {s.documents} document{s.documents === 1 ? "" : "s"}</>}
      </div>
    </button>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-input/60 rounded-lg px-2.5 py-2">
      <div className="text-text-muted">{label}</div>
      <div className="font-mono text-text text-[13px]">{value}</div>
    </div>
  );
}

function YearBars({ rows }: { rows: { year: string; total: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.year} className="flex items-center gap-3 text-xs">
          <span className="font-mono text-text-dim w-10 shrink-0">{r.year}</span>
          <div className="flex-1 h-2 rounded-full bg-white/[0.05] overflow-hidden">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(Math.max(0, r.total) / max) * 100}%` }} />
          </div>
          <span className="font-mono w-16 text-right shrink-0">{fmt(r.total)}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, hint, extra, id, children }: { title: string; hint?: string; extra?: React.ReactNode; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="bg-bg-card border border-border rounded-xl p-5 max-md:p-4 mb-6 scroll-mt-20">
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

function List({ children }: { children: React.ReactNode }) {
  return <div className="bg-bg-input border border-border rounded-lg max-h-[420px] overflow-y-auto">{children}</div>;
}

function Row({ title, sub, amount, action, onClick }: { title: string; sub?: string; amount?: string; action?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] truncate">{title}</span>
        {sub && <span className="block text-[11px] text-text-muted truncate">{sub}</span>}
      </span>
      {amount && <span className="font-mono text-xs shrink-0">{amount}</span>}
      {action && <span className="text-[11px] text-accent shrink-0 w-12 text-right">{action}</span>}
    </>
  );
  const cls = "w-full text-left flex items-center gap-3 px-3.5 py-2.5 border-b border-border/40 last:border-0";
  return onClick ? (
    <button className={`${cls} hover:bg-white/[0.03]`} onClick={onClick}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="font-mono text-[11px] opacity-60">{n}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-text-muted py-3">{children}</p>;
}
