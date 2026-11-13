import { useEffect, useRef, useState } from "react";

/**
 * Chart colors for the dark card surface. The three series hues are a
 * validated set (CVD and normal-vision separation, 3:1 on the surface), and
 * each one stays with its entity: a year keeps its color whatever is shown.
 */
export const CHART = {
  surface: "#181a24",
  grid: "#2a2d3e",
  axis: "#5c5f73",
  series: ["#3987e5", "#d95926", "#199e70"],
} as const;

/** Rendered width of a box, so charts draw at real pixels (crisp text, no stretching) */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** "$12k", "$950" for axis ticks */
export function shortMoney(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1000 ? `${Math.round(a / 100) / 10}k`.replace(".0k", "k") : `${Math.round(a)}`;
  return (n < 0 ? "-$" : "$") + s;
}

/** A tidy axis top and step for a max value: 1, 2, 2.5 or 5 × a power of ten */
export function niceTicks(max: number, count = 3): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export function Swatch({ color }: { color: string }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: color }} />;
}

/** Floating readout for a hovered mark, kept inside the chart box */
export function ChartTooltip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  const left = Math.max(0, Math.min(x - 80, width - 160));
  return (
    <div
      className="absolute top-0 z-10 w-40 pointer-events-none rounded-lg border border-border bg-bg-input/95 px-3 py-2 text-[11px] shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
      style={{ left }}
    >
      {children}
    </div>
  );
}
