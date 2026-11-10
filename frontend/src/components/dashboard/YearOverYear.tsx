import { useState } from "react";
import { fmt } from "../../lib/formatters";
import type { Pulse } from "../../types";
import { CHART, ChartTooltip, Swatch, niceTicks, shortMoney, useWidth } from "./charts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Year = Pulse["yoy"]["years"][number];

/** Newest year takes the first hue, so this year is always blue */
function colorFor(years: Year[], year: number): string {
  const order = [...years].sort((a, b) => b.year - a.year).map((y) => y.year);
  return CHART.series[order.indexOf(year)] ?? CHART.axis;
}

/** Running total of each year's spending; years overlap on the same Jan–Dec axis */
function CumulativeChart({ years }: { years: Year[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 220;
  const pad = { top: 10, right: 48, bottom: 22, left: 44 };
  const series = years.map((y) => {
    let run = 0;
    return { year: y.year, points: y.monthly.map((v) => (v == null ? null : (run += v))) };
  });
  const max = Math.max(1, ...series.flatMap((s) => s.points.filter((p): p is number => p != null)));
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (i / 11) * plotW;
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;

  // Year labels at each line's end, nudged apart so they never overlap
  const ends = series
    .map((s) => {
      const last = s.points.reduce<number>((li, p, i) => (p != null ? i : li), -1);
      return last < 0 ? null : { year: s.year, i: last, v: s.points[last]!, ly: y(s.points[last]!) };
    })
    .filter((e): e is NonNullable<typeof e> => e != null)
    .sort((a, b) => a.ly - b.ly);
  for (let k = 1; k < ends.length; k++) if (ends[k].ly - ends[k - 1].ly < 13) ends[k].ly = ends[k - 1].ly + 13;

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Spending so far each year, by month"
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const i = Math.round(((e.clientX - box.left - pad.left) / plotW) * 11);
            setHover(Math.max(0, Math.min(11, i)));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={CHART.grid} strokeWidth={1} />
              <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill={CHART.axis}>{shortMoney(t)}</text>
            </g>
          ))}
          {MONTHS.map((m, i) =>
            plotW > 360 || i % 2 === 0 ? (
              <text key={m} x={x(i)} y={height - 6} textAnchor="middle" fontSize={10} fill={CHART.axis}>{m}</text>
            ) : null
          )}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} stroke={CHART.axis} strokeWidth={1} />}
          {/* Oldest first, so this year draws on top */}
          {[...series].sort((a, b) => a.year - b.year).map((s) => {
            const pts = s.points.map((p, i) => (p == null ? null : `${x(i)},${y(p)}`)).filter(Boolean);
            const color = colorFor(years, s.year);
            return (
              <g key={s.year}>
                <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {hover != null && s.points[hover] != null && (
                  <circle cx={x(hover)} cy={y(s.points[hover]!)} r={4} fill={color} stroke={CHART.surface} strokeWidth={2} />
                )}
              </g>
            );
          })}
          {ends.map((e) => (
            <g key={e.year}>
              <circle cx={x(e.i)} cy={y(e.v)} r={4} fill={colorFor(years, e.year)} stroke={CHART.surface} strokeWidth={2} />
              <text x={x(e.i) + 8} y={e.ly} dy="0.32em" fontSize={11} fill="#8b8fa3">{e.year}</text>
            </g>
          ))}
        </svg>
      )}
      {hover != null && (
        <ChartTooltip x={x(hover)} width={width}>
          <div className="text-text font-medium mb-1">Through {MONTHS[hover]}</div>
          {[...series].sort((a, b) => b.year - a.year).map((s) => (
            <div key={s.year} className="flex justify-between gap-2 text-text-dim">
              <span className="flex items-center gap-1.5"><Swatch color={colorFor(years, s.year)} />{s.year}</span>
              <span className="font-mono text-text">{s.points[hover] != null ? fmt(s.points[hover]) : "—"}</span>
            </div>
          ))}
        </ChartTooltip>
      )}
    </div>
  );
}

export default function YearOverYear({ data }: { data: Pulse["yoy"] }) {
  const years = data.years;
  if (years.length < 2) return null;
  const [mm, dd] = data.through.split("-").map(Number);
  const through = `${MONTHS[mm - 1]} ${dd}`;
  const newestFirst = [...years].sort((a, b) => b.year - a.year);
  const [cur, prev] = newestFirst;
  const spentDiff = cur.ytd.spent - prev.ytd.spent;

  return (
    <div className="bg-bg-card border border-border rounded-xl p-6 max-md:p-5 mt-5">
      <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
        <div className="text-[14px] font-semibold uppercase tracking-wider text-text-dim">Year over year</div>
        <div className="text-[11px] text-text-muted">Each year compared Jan 1 – {through}</div>
      </div>
      <div className="text-[13px] text-text-dim mb-4">
        {cur.year} spending is{" "}
        <span className={spentDiff > 0 ? "text-red" : "text-green"}>
          {spentDiff > 0 ? "▲" : "▼"} {fmt(Math.abs(spentDiff))} {spentDiff > 0 ? "above" : "below"}
        </span>{" "}
        {prev.year} at this point.
      </div>

      <div className="flex items-center gap-4 text-[11px] text-text-dim mb-2">
        {newestFirst.map((y) => (
          <span key={y.year} className="flex items-center gap-1.5"><Swatch color={colorFor(years, y.year)} />{y.year}</span>
        ))}
        <span className="text-text-muted">· running total of spending</span>
      </div>
      <CumulativeChart years={years} />

      <div className="grid grid-cols-[1.3fr_1fr] max-lg:grid-cols-1 gap-6 mt-6">
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-text-muted">
                <th className="text-left font-semibold pb-2">Year</th>
                <th className="text-right font-semibold pb-2">Spent</th>
                <th className="text-right font-semibold pb-2">Income</th>
                <th className="text-right font-semibold pb-2">Net</th>
                <th className="text-right font-semibold pb-2 pl-3">Full year</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {newestFirst.map((y) => (
                <tr key={y.year} className="border-t border-border/40">
                  <td className="py-2 font-sans"><span className="flex items-center gap-1.5"><Swatch color={colorFor(years, y.year)} />{y.year}</span></td>
                  <td className="py-2 text-right">{fmt(y.ytd.spent)}</td>
                  <td className="py-2 text-right">{fmt(y.ytd.income)}</td>
                  <td className={`py-2 text-right ${y.ytd.net >= 0 ? "text-green" : "text-red"}`}>{y.ytd.net >= 0 ? "+" : "−"}{fmt(Math.abs(y.ytd.net))}</td>
                  <td className="py-2 text-right pl-3 text-text-dim">{y.fullYear ? fmt(y.fullYear.spent) : "in progress"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[11px] text-text-muted mt-2">Spent, income and net cover Jan 1 – {through} of each year. Full year is total spending.</div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">Biggest changes vs {prev.year}</div>
          {data.changes.length === 0 ? (
            <div className="text-[13px] text-text-dim py-2">No category moved by $100 or more.</div>
          ) : (
            data.changes.map((c) => (
              <div key={c.category} className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0">
                <div className="min-w-0">
                  <div className="text-sm truncate">{c.category}</div>
                  <div className="text-[11px] text-text-muted font-mono">{fmt(c.before)} → {fmt(c.now)}</div>
                </div>
                <div className={`font-mono text-[13px] shrink-0 ${c.diff > 0 ? "text-red" : "text-green"}`}>
                  {c.diff > 0 ? "▲" : "▼"} {fmt(Math.abs(c.diff))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
