import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../lib/api";

interface ImportButtonProps {
  onToast: (msg: string, err?: boolean) => void;
  /** Called after anything changes the stored transactions */
  onChanged: () => void;
}

interface FileRun {
  name: string;
  state: "waiting" | "working" | "done" | "error";
  added?: number;
  already?: number;
  accounts?: string[];
  message?: string;
}

/** File → base64 (no data: prefix), in chunks so large PDFs don't overflow the call stack */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Import bank activity: CSV exports or PDF statements, several at once. While files
 * import, a full-screen overlay shows progress and blocks the rest of the app; it ends
 * on a summary of what each file added.
 */
export default function ImportButton({ onToast, onChanged }: ImportButtonProps) {
  const [runs, setRuns] = useState<FileRun[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = runs?.some((r) => r.state === "waiting" || r.state === "working") ?? false;

  async function upload(files: FileList) {
    const list = [...files].filter((f) => /\.(csv|pdf)$/i.test(f.name));
    if (!list.length) return onToast("Choose a .csv or .pdf file", true);
    const next: FileRun[] = list.map((f) => ({ name: f.name, state: "waiting" }));
    const set = (i: number, patch: Partial<FileRun>) => {
      next[i] = { ...next[i], ...patch };
      setRuns([...next]);
    };
    setRuns([...next]);
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      set(i, { state: "working" });
      try {
        const r = /\.pdf$/i.test(f.name)
          ? await api.transactions.upload(f.name, await toBase64(f), "base64")
          : await api.transactions.upload(f.name, await f.text());
        if (r.imported.length) {
          changed = true;
          set(i, {
            state: "done",
            added: r.imported.reduce((s, x) => s + x.inserted, 0),
            already: r.imported.reduce((s, x) => s + x.duplicates, 0),
            accounts: [...new Set(r.imported.map((x) => x.accountName))],
          });
        } else if (r.unrecognized.length) {
          set(i, { state: "error", message: r.unrecognized.map((u) => u.error).join(" · ") });
        } else {
          set(i, { state: "done", added: 0, message: "Already imported" });
        }
      } catch (err) {
        set(i, { state: "error", message: err instanceof Error ? err.message : "Import failed" });
      }
    }
    if (changed) onChanged();
  }

  return (
    <>
      <button className="btn btn-sm inline-flex items-center gap-1.5" disabled={busy} onClick={() => fileRef.current?.click()}>
        <svg aria-hidden viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
        </svg>
        Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv,.pdf,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) upload(e.target.files);
          e.target.value = "";
        }}
      />
      {runs && <ImportOverlay runs={runs} busy={busy} onDone={() => setRuns(null)} />}
    </>
  );
}

function ImportOverlay({ runs, busy, onDone }: { runs: FileRun[]; busy: boolean; onDone: () => void }) {
  const doneBtn = useRef<HTMLButtonElement>(null);
  const finished = runs.filter((r) => r.state === "done" || r.state === "error").length;
  const current = runs.find((r) => r.state === "working");
  const added = runs.reduce((s, r) => s + (r.added ?? 0), 0);
  const failed = runs.filter((r) => r.state === "error").length;
  const pct = Math.round(((finished + (current ? 0.5 : 0)) / runs.length) * 100);

  // Nothing behind the overlay scrolls or takes keys while it's up
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const block = (e: KeyboardEvent) => {
      if (busy) {
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onDone();
      }
    };
    document.addEventListener("keydown", block, true);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", block, true);
    };
  }, [busy, onDone]);

  useEffect(() => {
    if (!busy) doneBtn.current?.focus();
  }, [busy]);

  const title = busy ? "Importing" : failed === runs.length ? "Couldn't import" : "Import complete";
  const summary = busy
    ? `File ${Math.min(finished + 1, runs.length)} of ${runs.length}`
    : `${added} new transaction${added === 1 ? "" : "s"}${failed ? ` · ${failed} file${failed === 1 ? "" : "s"} not imported` : ""}`;

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-busy={busy}
      aria-labelledby="import-title"
      className="fixed inset-0 z-[400] grid place-items-center p-4 bg-[#07080d]/80 backdrop-blur-md animate-[fadeIn_0.18s_ease]"
      style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div className="w-full max-w-[400px] bg-bg-card border border-border rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.55)] overflow-hidden animate-[popIn_0.22s_cubic-bezier(0.2,0.9,0.3,1.2)]">
        <div className="px-6 pt-7 pb-5 text-center">
          <div className="mx-auto mb-4 w-14 h-14 relative grid place-items-center">
            {busy ? (
              <>
                <div className="absolute inset-0 rounded-full border-2 border-accent/15" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent animate-spin" />
                <svg aria-hidden viewBox="0 0 24 24" className="w-6 h-6 text-accent" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5M9 13h6M9 17h4" />
                </svg>
              </>
            ) : (
              <div className={`w-14 h-14 rounded-full grid place-items-center animate-[popIn_0.25s_ease] ${failed === runs.length ? "bg-red/15 text-red" : "bg-green-dim text-green"}`}>
                <svg aria-hidden viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  {failed === runs.length ? <path d="M12 8v5M12 16.5v.5" /> : <path d="M5 12.5l4.5 4.5L19 7.5" />}
                </svg>
              </div>
            )}
          </div>
          <h2 id="import-title" className="text-[17px] font-semibold">{title}</h2>
          <p className="text-[13px] text-text-dim mt-1" aria-live="polite">{summary}</p>

          <div className="mt-4 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-out ${busy ? "bg-accent" : failed === runs.length ? "bg-red" : "bg-green"}`}
              style={{ width: `${busy ? Math.max(pct, 6) : 100}%` }}
            />
          </div>
        </div>

        <ul className="max-h-[38vh] overflow-y-auto border-t border-border/60 divide-y divide-border/40">
          {runs.map((r, i) => (
            <li key={i} className="flex items-start gap-3 px-5 py-3">
              <span className="mt-0.5 w-4 h-4 shrink-0 grid place-items-center">
                {r.state === "working" ? (
                  <span className="w-3.5 h-3.5 rounded-full border-[1.5px] border-accent/25 border-t-accent animate-spin" />
                ) : r.state === "waiting" ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60" />
                ) : r.state === "error" ? (
                  <span className="text-red text-[13px] leading-none">!</span>
                ) : (
                  <svg aria-hidden viewBox="0 0 16 16" className="w-3.5 h-3.5 text-green" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-[13px] truncate ${r.state === "waiting" ? "text-text-muted" : "text-text"}`}>{r.name}</div>
                {(r.state === "done" || r.state === "error") && (
                  <div className={`text-[11px] mt-0.5 ${r.state === "error" ? "text-red" : "text-text-muted"}`}>
                    {r.state === "error"
                      ? r.message
                      : r.message ?? `${r.added} new${r.already ? `, ${r.already} already had` : ""} · ${r.accounts?.join(", ")}`}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        {!busy && (
          <div className="p-4 border-t border-border/60">
            <button ref={doneBtn} className="btn btn-primary w-full" onClick={onDone}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
