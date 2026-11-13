import type { CostChange, CostChanges as Data } from "../../types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Whole dollars under $100 keep cents only when they matter ($9.91), bigger ones don't */
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

function Row({ name, before, now, per, pct, note }: { name: string; before: string; now: string; per: string; pct: number; note?: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">{name}</div>
        <div className="text-[12px] text-text-dim">
          <span className="font-mono">{before} → <span className="text-text">{now}</span></span> {per}
          {note && <span className="block text-[11px] text-text-muted">{note}</span>}
        </div>
      </div>
      <Pct value={pct} />
    </div>
  );
}

function Column({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">{title}</div>
      {children}
      {footer && <div className="text-[12px] text-text-dim mt-2">{footer}</div>}
    </div>
  );
}

/** The one-sentence answer, built from whichever parts the data has */
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

/** What costs more: food at home vs out, same-place prices, and bills, against a year earlier */
export default function CostChanges({ data }: { data: Data }) {
  if (!data.food && !data.places.length && !data.bills.length) return null;
  const lines = takeaway(data);
  const g = data.food?.groceries;
  const o = data.food?.dining;
  const foodTotal = g && o ? { before: g.before.perMonth + o.before.perMonth, now: g.now.perMonth + o.now.perMonth } : null;

  return (
    <div className="bg-bg-card border border-border rounded-xl p-6 max-md:p-5 mt-5">
      <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
        <div className="text-[14px] font-semibold uppercase tracking-wider text-text-dim">What costs more</div>
        <div className="text-[11px] text-text-muted">
          {monthLabel(data.recent.from)} – {monthLabel(data.recent.to)} vs the year before
        </div>
      </div>
      {lines.length > 0 && (
        <div className="text-[15px] leading-relaxed mb-5 max-w-[760px]">
          {lines.map((l) => (
            <p key={l}>
              {/* The numbers carry the point, so they stand out */}
              {l.split(/(\$[\d,]+|\d+ fewer times?|\d+% more)/).map((part, i) =>
                i % 2 ? <strong key={i} className="font-semibold text-text">{part}</strong> : <span key={i} className="text-text-dim">{part}</span>
              )}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 max-lg:grid-cols-2 max-md:grid-cols-1 gap-x-8 gap-y-6">
        {g && o && foodTotal && (
          <Column
            title="Food, a month"
            footer={
              <>
                All food: <span className="font-mono">{whole(foodTotal.before)} → <span className="text-text">{whole(foodTotal.now)}</span></span>
              </>
            }
          >
            <Row
              name="Groceries"
              before={whole(g.before.perMonth)}
              now={whole(g.now.perMonth)}
              per=""
              pct={g.now.perMonth / g.before.perMonth - 1}
              note={`${g.now.timesPerMonth} trips a month`}
            />
            <Row
              name="Eating out"
              before={whole(o.before.perMonth)}
              now={whole(o.now.perMonth)}
              per=""
              pct={o.now.perMonth / o.before.perMonth - 1}
              note={o.now.timesPerMonth === o.before.timesPerMonth ? `${o.now.timesPerMonth} times a month` : `${o.before.timesPerMonth} → ${o.now.timesPerMonth} times a month`}
            />
          </Column>
        )}

        {data.places.length > 0 && (
          <Column title="Same place, higher price" footer="Average spent per visit, at places you go often">
            {data.places.slice(0, 4).map((p: CostChange) => (
              <Row key={p.name} name={p.name} before={money(p.before)} now={money(p.now)} per={p.per} pct={p.pct} />
            ))}
          </Column>
        )}

        {data.bills.length > 0 && (
          <Column title="Bills that went up" footer="Same service, a year apart">
            {data.bills.map((b: CostChange) => (
              <Row key={b.name} name={b.name} before={money(b.before)} now={money(b.now)} per={b.per} pct={b.pct} note={b.detail} />
            ))}
          </Column>
        )}
      </div>
    </div>
  );
}
