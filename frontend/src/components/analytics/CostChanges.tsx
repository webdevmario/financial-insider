import type { CostChange, CostChanges as Data } from "../../types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Cents only where they matter ($9.91); bigger amounts round */
const money = (n: number) => {
  const a = Math.abs(n);
  return `$${a >= 100 ? Math.round(a).toLocaleString("en-US") : a % 1 === 0 ? a.toFixed(0) : a.toFixed(2)}`;
};
const whole = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

function Pct({ value }: { value: number }) {
  const up = value > 0;
  return (
    <span className={`shrink-0 font-mono text-[12px] font-semibold px-1.5 py-0.5 rounded-md ${up ? "text-red bg-red/10" : "text-green bg-green-dim"}`}>
      {up ? "+" : "−"}{Math.round(Math.abs(value) * 100)}%
    </span>
  );
}

function Row({ name, before, now, per, pct, sub, tag }: {
  name: string; before: string; now: string; per?: string; pct: number; sub?: string; tag?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">
          {name}
          {tag && <span className="ml-1.5 align-middle text-[10px] uppercase tracking-wide text-text-muted border border-border rounded px-1 py-px">{tag}</span>}
        </div>
        <div className="text-[12px] text-text-dim">
          <span className="font-mono">{before} → <span className="text-text">{now}</span></span>
          {per && <> {per}</>}
          {sub && <span className="text-text-muted"> · {sub}</span>}
        </div>
      </div>
      <Pct value={pct} />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl px-5 pt-4 pb-2 min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">{title}</div>
      {children}
    </div>
  );
}

/** The plain-words answer, built from whichever parts the data has */
function takeaway(d: Data): string[] {
  const lines: string[] = [];
  if (d.food) {
    const { groceries: g, dining: o } = d.food;
    const total = g.now.perMonth + o.now.perMonth - (g.before.perMonth + o.before.perMonth);
    const gUp = g.now.perMonth - g.before.perMonth;
    const visits = o.now.timesPerMonth - o.before.timesPerMonth;
    let s = `Food costs ${whole(total)} ${total >= 0 ? "more" : "less"} a month than a year ago`;
    if (gUp > 0 && visits < 0) s += `: groceries are up ${whole(gUp)} a month while you eat out ${-visits} fewer time${visits === -1 ? "" : "s"} a month`;
    else if (gUp > 0) s += `: groceries are up ${whole(gUp)} a month`;
    const store = d.places.find((p) => p.per === "a trip");
    s += store ? `, and the average ${store.name} trip costs ${Math.round(store.pct * 100)}% more.` : ".";
    lines.push(s);
  }
  const billsUp = d.bills.reduce((s, b) => s + (b.monthly ?? 0), 0);
  if (d.bills.length) lines.push(`${d.bills.length} bill${d.bills.length === 1 ? "" : "s"} went up, adding ${whole(billsUp)} a month.`);
  return lines;
}

/** What costs more than a year ago: the answer up top, the evidence below */
export default function CostChanges({ data }: { data: Data }) {
  if (!data.food && !data.places.length && !data.bills.length) return null;
  const lines = takeaway(data);
  const g = data.food?.groceries;
  const o = data.food?.dining;

  return (
    <section>
      <div className="relative overflow-hidden rounded-2xl border border-accent/25 bg-[linear-gradient(135deg,rgba(74,108,247,0.16),rgba(24,26,36,0.9)_55%)] px-7 py-6 max-md:px-5 max-md:py-5">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 w-64 h-64 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex items-baseline justify-between gap-3 flex-wrap mb-3">
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">What costs more</div>
          <div className="text-[11px] text-text-muted">
            {monthLabel(data.recent.from)} – {monthLabel(data.recent.to)} vs the year before
          </div>
        </div>
        <div className="relative space-y-2 text-[19px] max-md:text-[17px] leading-snug max-w-[900px]">
          {lines.map((l) => (
            <p key={l}>
              {l.split(/(\$[\d,]+|\d+ fewer times?|\d+% more)/).map((part, i) =>
                i % 2 ? <strong key={i} className="font-semibold text-text">{part}</strong> : <span key={i} className="text-text-dim">{part}</span>
              )}
            </p>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 max-lg:grid-cols-2 max-md:grid-cols-1 gap-4 mt-4">
        {g && o && (
          <Panel title="Food, a month">
            <Row
              name="Groceries"
              before={whole(g.before.perMonth)}
              now={whole(g.now.perMonth)}
              pct={g.now.perMonth / g.before.perMonth - 1}
              sub={g.before.timesPerMonth !== g.now.timesPerMonth ? `${g.before.timesPerMonth} → ${g.now.timesPerMonth} trips` : undefined}
            />
            <Row
              name="Eating out"
              before={whole(o.before.perMonth)}
              now={whole(o.now.perMonth)}
              pct={o.now.perMonth / o.before.perMonth - 1}
              sub={o.before.timesPerMonth !== o.now.timesPerMonth ? `${o.before.timesPerMonth} → ${o.now.timesPerMonth} visits` : undefined}
            />
            <Row
              name="All food"
              before={whole(g.before.perMonth + o.before.perMonth)}
              now={whole(g.now.perMonth + o.now.perMonth)}
              pct={(g.now.perMonth + o.now.perMonth) / (g.before.perMonth + o.before.perMonth) - 1}
            />
          </Panel>
        )}

        {data.places.length > 0 && (
          <Panel title="Same place, higher price">
            {data.places.slice(0, 5).map((p: CostChange) => (
              <Row key={p.name} name={p.name} before={money(p.before)} now={money(p.now)} per={p.per} pct={p.pct} />
            ))}
          </Panel>
        )}

        {data.bills.length > 0 && (
          <Panel title="Bills that went up">
            {data.bills.map((b: CostChange) => (
              <Row key={b.name} name={b.name} before={money(b.before)} now={money(b.now)} per={b.per} pct={b.pct} tag={b.detail ? "usage" : undefined} />
            ))}
          </Panel>
        )}
      </div>
    </section>
  );
}
