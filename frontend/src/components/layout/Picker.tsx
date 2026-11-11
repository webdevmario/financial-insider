import { useId, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import { useIsPhone } from "../../hooks/useIsPhone";

interface PickerProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  /** Sheet title on phones, such as "Category" */
  title: string;
  placeholder?: string;
  /** Offer an option that empties the field, with this label (e.g. "Keep what the bank says") */
  clearLabel?: string;
  /** Extra props for the desktop text input */
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}

const MAX_ROWS = 80;

/**
 * Free text with suggestions. Desktop keeps a plain input with a datalist;
 * on phones (where datalist is clumsy, especially on iOS) the field opens a
 * searchable list sheet, with "Use …" for a value that isn't listed yet.
 */
export default function Picker({ value, onChange, options, title, placeholder, clearLabel, inputProps }: PickerProps) {
  const phone = useIsPhone();
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? options.filter((o) => o.toLowerCase().includes(q)) : options),
    [options, q]
  );
  const exact = options.some((o) => o.toLowerCase() === q);

  if (!phone) {
    return (
      <>
        <input list={listId} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} {...inputProps} />
        <datalist id={listId}>
          {options.map((o) => <option key={o} value={o} />)}
        </datalist>
      </>
    );
  }

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    // Lets the surrounding form sheet notice the edit (it listens for input events)
    triggerRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const row = "flex items-center gap-3 w-full text-left px-3 min-h-12 rounded-lg text-sm transition-colors";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
        className="flex items-center justify-between gap-2 w-full text-left text-base py-2.5 px-3.5 rounded-lg border border-border bg-bg-input min-h-11"
      >
        <span className={`truncate ${value ? "text-text" : "text-text-muted"}`}>{value || placeholder || "Choose"}</span>
        <span aria-hidden className="text-text-muted text-lg opacity-60">›</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} variant="list" title={title} className="max-md:h-[85%]">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search or type a new ${title.toLowerCase()}`}
          enterKeyHint="done"
          autoCorrect="off"
          autoCapitalize="words"
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !q) return;
            pick(options.find((o) => o.toLowerCase() === q) ?? query.trim());
          }}
          className="mb-3"
        />
        <div className="flex flex-col gap-0.5">
          {query.trim() && !exact && (
            <button type="button" className={`${row} text-accent hover:bg-accent/10`} onClick={() => pick(query.trim())}>
              Use “{query.trim()}”
            </button>
          )}
          {clearLabel && !q && (
            <button type="button" className={`${row} text-text-dim hover:bg-white/[0.04]`} onClick={() => pick("")}>
              {clearLabel}
            </button>
          )}
          {matches.slice(0, MAX_ROWS).map((o) => (
            <button
              key={o}
              type="button"
              className={`${row} ${o === value ? "bg-accent/10 text-accent" : "text-text hover:bg-white/[0.04]"}`}
              onClick={() => pick(o)}
            >
              <span className="truncate">{o}</span>
            </button>
          ))}
          {matches.length > MAX_ROWS && (
            <p className="text-xs text-text-muted px-3 py-2">{matches.length - MAX_ROWS} more. Search to narrow the list.</p>
          )}
        </div>
      </Modal>
    </>
  );
}
