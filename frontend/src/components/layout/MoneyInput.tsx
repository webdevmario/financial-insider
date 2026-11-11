import { forwardRef } from "react";

interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: string;
  onChange: (value: string) => void;
}

/**
 * An amount field. A text input with the decimal keypad rather than
 * type="number": iOS shows the full keyboard for type="number" and silently
 * empties the value on anything it can't parse. Keeps digits, one point and
 * a leading minus (typed on a hardware keyboard); callers parseFloat as before.
 */
const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, className = "", placeholder = "0.00", enterKeyHint = "done", ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      enterKeyHint={enterKeyHint}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(clean(e.target.value))}
      className={`font-mono ${className}`}
      {...rest}
    />
  );
});

export default MoneyInput;

function clean(raw: string): string {
  const negative = raw.trimStart().startsWith("-");
  // Commas from a pasted "1,234.50" are dropped, not read as a decimal point
  const [whole, ...frac] = raw.replace(/[^\d.]/g, "").split(".");
  const num = frac.length ? `${whole}.${frac.join("").slice(0, 2)}` : whole;
  return (negative ? "-" : "") + num;
}
