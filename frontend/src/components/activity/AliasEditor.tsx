import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDate, fmtP } from "../../lib/formatters";
import { MATCH_LABELS } from "./shared";
import type { AliasMatch, AliasPreview } from "../../types";

export interface AliasDraft {
  pattern: string;
  match: AliasMatch;
  amount: number | null;
}

interface Props {
  value: AliasDraft;
  onChange: (v: AliasDraft) => void;
  /** Offer "only at this amount" with this amount */
  amountHint?: number;
}

/** Alias text + match type + optional amount, with a live preview of what it would match */
export default function AliasEditor({ value, onChange, amountHint }: Props) {
  const [preview, setPreview] = useState<AliasPreview | null>(null);

  useEffect(() => {
    if (value.pattern.trim().length < 3) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      api.payees.preview(value).then(setPreview).catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [value.pattern, value.match, value.amount]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <select
          value={value.match}
          onChange={(e) => onChange({ ...value, match: e.target.value as AliasMatch })}
          className="!w-auto shrink-0"
        >
          {(Object.keys(MATCH_LABELS) as AliasMatch[]).map((m) => <option key={m} value={m}>{MATCH_LABELS[m]}</option>)}
        </select>
        <input
          value={value.pattern}
          onChange={(e) => onChange({ ...value, pattern: e.target.value })}
          className="font-mono min-w-0"
          placeholder="Text from the statement"
        />
      </div>
      {amountHint != null && (
        <label className="flex items-center gap-2 text-xs text-text-dim cursor-pointer">
          <input
            type="checkbox"
            checked={value.amount != null}
            onChange={(e) => onChange({ ...value, amount: e.target.checked ? Math.abs(amountHint) : null })}
          />
          Only when the amount is exactly <span className="font-mono">{fmtP(Math.abs(amountHint))}</span>
        </label>
      )}
      {preview && (
        <div className="text-[11px] text-text-muted bg-white/[0.03] rounded-lg px-3 py-2">
          <div className={preview.count > 300 ? "text-amber" : ""}>
            Matches <span className="font-mono text-text">{preview.count}</span> transaction{preview.count === 1 ? "" : "s"}
            {preview.merchants.length > 1 && <> across {preview.merchants.length}{preview.merchants.length === 12 ? "+" : ""} bank names</>}
            {preview.count > 300 && " · that's a lot, check it isn't too broad"}
          </div>
          {preview.samples.slice(0, 4).map((s) => (
            <div key={s.id} className="flex justify-between gap-3 mt-1">
              <span className="truncate font-mono">{fmtDate(s.date)} · {s.description}</span>
              <span className="font-mono shrink-0">{fmtP(s.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
