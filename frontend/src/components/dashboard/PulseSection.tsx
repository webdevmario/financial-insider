import { useState } from "react";
import { fmt } from "../../lib/formatters";
import type { Pulse } from "../../types";
import { CHART, ChartTooltip, Swatch, columnPath, niceTicks, shortMoney, useWidth } from "./charts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1];
const dayLabel = (date: string) => `${monthName(date)} ${Number(date.slice(8, 10))}`;

const FIXED = CHART.series[0];
const FLEXIBLE = CHART.series[1];

/** "$514 under" / "$300 over" with an arrow, so the direction never rides on color alone */
function Versus({ diff, goodWhenUnder = true }: { diff: number; goodWhenUnder?: boolean }) {
  if (Math.abs(diff) < 1) return <span className="text-text-dim">right on usual</span>;
  const under = diff < 0;
  const good = under === goodWhenUnder;
  return (
    <span className={good ? "text-green" : "text-red"}>
      {under ? "▼" : "▲"} {fmt(Math.abs(diff))} {under ? "under" : "over"}
    </span>
  );
}

function Figure({ label, value, children }: { label: string; value: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</div>
      <div className="font-mono text-[26px] leading-tight font-semibold mt-1">{value}</div>
      <div className="text-[12px] text-text-dim mt-1">{children}</div>
    </div>
  );
}

/** Fixed (bills) and flexible spending per month, stacked; the last column is this month so far */
function SplitChart({ split }: { split: Pulse["pulse"]["split"] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 170;
  const pad = { top: 8, right: 4, bottom: 22, left: 40 };
  const ticks = niceTicks(Math.max(...split.map((s) => s.fixed + s.flexible), 1));
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const band = split.length ? plotW / split.length : 0;
  const barW = Math.min(24, band * 0.62);
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const h = (v: number) => (v / top) * plotH;
  const shown = hover != null ? split[hover] : null;

  return (
    <div>
      <div className="flex items-center gap-4 text-[11px] text-text-dim mb-2">
        <span className="flex items-center gap-1.5"><Swatch color={FIXED} />Fixed (bills)</span>
        <span className="flex items-center gap-1.5"><Swatch color={FLEXIBLE} />Flexible</span>
      </div>
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Fixed and flexible spending by month">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={CHART.grid} strokeWidth={1} />
                <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill={CHART.axis}>{shortMoney(t)}</text>
              </g>
            ))}
            {split.map((s, i) => {
              const x = pad.left + i * band + (band - barW) / 2;
              const fixedH = h(s.fixed);
              const flexH = h(Math.max(0, s.flexible));
              // 2px of surface between the stacked parts; the top part carries the rounded end
              const gap = fixedH > 0 && flexH > 0 ? 2 : 0;
              const dim = hover != null && hover !== i;
              return (
                <g key={s.month} opacity={dim ? 0.45 : s.partial ? 0.7 : 1}>
                  {flexH > 0 && <path d={columnPath(x, y(s.fixed + Math.max(0, s.flexible)), barW, Math.max(0, flexH - gap))} fill={FLEXIBLE} />}
                  {fixedH > 0 && <path d={flexH > 0 ? `M${x},${y(0)}V${y(s.fixed)}H${x + barW}V${y(0)}Z` : columnPath(x, y(s.fixed), barW, fixedH)} fill={FIXED} />}
                  {(i % 2 === split.length % 2 || band > 34) && (
                    <text x={x + barW / 2} y={height - 6} textAnchor="middle" fontSize={10} fill={CHART.axis}>
                      {monthName(s.month)}
                    </text>
                  )}
                  {/* The whole column band is the hover target */}
                  <rect
                    x={pad.left + i * band}
                    y={pad.top}
                    width={band}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onClick={() => setHover(i)}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {shown && hover != null && (
          <ChartTooltip x={pad.left + hover * band + band / 2} width={width}>
            <div className="text-text font-medium mb-1">
              {monthName(shown.month)} {shown.month.slice(0, 4)}{shown.partial ? " (so far)" : ""}
            </div>
            <div className="flex justify-between gap-2 text-text-dim"><span className="flex items-center gap-1.5"><Swatch color={FIXED} />Fixed</span><span className="font-mono text-text">{fmt(shown.fixed)}</span></div>
            <div className="flex justify-between gap-2 text-text-dim"><span className="flex items-center gap-1.5"><Swatch color={FLEXIBLE} />Flexible</span><span className="font-mono text-text">{fmt(shown.flexible)}</span></div>
            <div className="flex justify-between gap-2 text-text-dim border-t border-border mt-1 pt-1"><span>Total</span><span className="font-mono text-text">{fmt(shown.fixed + shown.flexible)}</span></div>
          </ChartTooltip>
        )}
      </div>
    </div>
  );
}

export default function PulseSection({ data }: { data: Pulse["pulse"] }) {
  const through = dayLabel(data.asOf);
  const netGood = data.netOnPace >= 0;
  const left = [data.saved > 0 && `${fmt(data.saved)} to savings`, data.reimbursed > 0 && `${fmt(data.reimbursed)} reimbursable work spending`].filter(Boolean);

  return (
    <div className="bg-bg-card border border-border rounded-xl p-6 max-md:p-5 mb-5">
      <div className="flex items-baseline justify-between gap-3 mb-5 flex-wrap">
        <div className="text-[14px] font-semibold uppercase tracking-wider text-text-dim">{monthName(data.month)} pulse</div>
        <div className="text-[11px] text-text-muted">Statements through {through} · compared with your last 12 months</div>
      </div>

      <div className="grid grid-cols-3 max-md:grid-cols-1 gap-5 mb-6">
        <Figure label="Spent so far" value={fmt(data.spent)}>
          <Versus diff={data.spent - data.usualSpentByNow} /> usual by {through}
        </Figure>
        <Figure label="On pace for" value={fmt(data.spentOnPace)}>
          <Versus diff={data.spentOnPace - data.usualMonth} /> a usual month ({fmt(data.usualMonth)})
        </Figure>
        <Figure
          label="Net on pace"
          value={<span className={netGood ? "text-green" : "text-red"}>{netGood ? "+" : "−"}{fmt(Math.abs(data.netOnPace))}</span>}
        >
          {netGood ? "Left over" : "Short"} after spending, with income on pace for {fmt(data.incomeOnPace)}
        </Figure>
      </div>

      <div className="grid grid-cols-[1.6fr_1fr] max-lg:grid-cols-1 gap-6">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">Fixed vs flexible</div>
          <SplitChart split={data.split} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">Running hot</div>
          {data.hot.length === 0 ? (
            <div className="text-[13px] text-text-dim py-2">Nothing above its usual pace for {through}.</div>
          ) : (
            <div className="flex flex-col">
              {data.hot.map((c) => (
                <div key={c.category} className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0">
                  <div className="min-w-0">
                    <div className="text-sm truncate">{c.category}</div>
                    <div className="text-[11px] text-text-muted">
                      {c.usual < 1 ? `usually nothing by ${through}` : `usually ${fmt(c.usual)} by ${through}`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-sm">{fmt(c.current)}</div>
                    <div className="text-[11px] text-red">▲ {fmt(c.diff)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="text-[11px] text-text-muted mt-3 leading-relaxed">
            Flexible spending only; bills land on their own schedule.
            {left.length > 0 && <> Not counted as spending: {left.join(", ")}.</>}
          </div>
        </div>
      </div>
    </div>
  );
}
