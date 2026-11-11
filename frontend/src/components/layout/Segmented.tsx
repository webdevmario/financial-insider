interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; disabled?: boolean; activeClass?: string }[];
  /** Stretch to the full width with equal segments (default: fit the labels) */
  full?: boolean;
  className?: string;
}

/** A row of mutually exclusive choices. 44px tall on phones, compact on desktop */
export default function Segmented<T extends string>({ value, onChange, options, full, className = "" }: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      className={`gap-0.5 p-0.5 bg-bg-input border border-border rounded-lg ${
        full ? "grid" : "inline-grid max-md:grid"
      } ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 max-md:min-h-[42px] rounded-md text-[13px] font-medium whitespace-nowrap transition-all disabled:opacity-40 ${
              on ? o.activeClass ?? "text-accent bg-accent/[0.1]" : "text-text-dim hover:text-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
