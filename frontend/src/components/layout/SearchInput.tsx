import { useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Classes for the wrapper (width, margins) */
  className?: string;
}

/** Search filter with an × to clear it. Esc clears too, and focus stays in the box. */
export default function SearchInput({ value, onChange, placeholder, className = "" }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const clear = () => {
    onChange("");
    ref.current?.focus();
  };
  return (
    <div className={`relative ${className}`}>
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Only swallow Esc when there's something to clear, so it still closes a dialog otherwise
          if (e.key === "Escape" && value) {
            e.preventDefault();
            e.stopPropagation();
            clear();
          }
        }}
        className={`!text-sm !py-1.5 ${value ? "!pr-9" : ""}`}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear"
          // Keep focus in the input on desktop (mousedown would blur it first)
          onMouseDown={(e) => e.preventDefault()}
          onClick={clear}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-white/[0.06] text-xs"
        >
          ✕
        </button>
      )}
    </div>
  );
}
