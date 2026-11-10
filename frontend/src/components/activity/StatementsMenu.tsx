import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { fmtDate } from "../../lib/formatters";
import Confirm from "../layout/Confirm";
import Modal from "../layout/Modal";
import type { ImportBatch, ScanResult } from "../../types";

interface StatementsMenuProps {
  onToast: (msg: string, err?: boolean) => void;
  /** Called after anything changes the stored transactions */
  onChanged: () => void;
}

const SEEN_KEY = "activity.seenScanWarning";
const isPhone = () => window.matchMedia("(max-width: 767px)").matches;

function describeScan(r: ScanResult): string {
  const added = r.imported.reduce((s, i) => s + i.inserted, 0);
  if (!r.imported.length && !r.unrecognized.length) return "No new files";
  const parts = [];
  if (r.imported.length) parts.push(`${r.imported.length} file${r.imported.length === 1 ? "" : "s"} · ${added} new transactions`);
  if (r.unrecognized.length) parts.push(`${r.unrecognized.length} not recognized`);
  return parts.join(" · ");
}

/** File → base64 (no data: prefix), in chunks so large PDFs don't overflow the call stack */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Statement imports, kept out of the way behind a ⋯ button: a small menu on
 * desktop, a bottom sheet on phones. Most imports come in through the
 * watched folder, so this is only for the occasional manual upload or undo.
 */
export default function StatementsMenu({ onToast, onChanged }: StatementsMenuProps) {
  const [folder, setFolder] = useState("");
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [undoing, setUndoing] = useState<ImportBatch | null>(null);
  const [seenScan, setSeenScan] = useState(readSeen);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    return api.transactions
      .imports()
      .then((r) => {
        setFolder(r.folder);
        setBatches(r.batches);
        setLastScan(r.lastScan);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Desktop menu: close on a click elsewhere or Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function after(r: ScanResult) {
    setLastScan(r);
    await load();
    if (r.imported.length) onChanged();
    onToast(describeScan(r), r.unrecognized.length > 0 && !r.imported.length);
  }

  async function scan() {
    setBusy(true);
    try {
      await after(await api.transactions.scan());
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Scan failed", true);
    } finally {
      setBusy(false);
    }
  }

  async function upload(files: FileList | File[]) {
    const list = [...files].filter((f) => /\.(csv|pdf)$/i.test(f.name));
    if (!list.length) return onToast("Choose a .csv or .pdf statement", true);
    setBusy(true);
    try {
      let last: ScanResult | null = null;
      const combined: ScanResult = { scannedAt: "", folder, imported: [], skipped: 0, unrecognized: [] };
      for (const f of list) {
        last = /\.pdf$/i.test(f.name)
          ? await api.transactions.upload(f.name, await toBase64(f), "base64")
          : await api.transactions.upload(f.name, await f.text());
        combined.imported.push(...last.imported);
        combined.unrecognized.push(...last.unrecognized);
      }
      if (last) await after({ ...last, imported: combined.imported, unrecognized: combined.unrecognized });
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Upload failed", true);
    } finally {
      setBusy(false);
    }
  }

  async function undo(b: ImportBatch) {
    setUndoing(null);
    try {
      const r = await api.transactions.undoImport(b.id);
      onToast(`Removed ${r.removed} transactions`);
      await load();
      onChanged();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Undo failed", true);
    }
  }

  async function reimport(b: ImportBatch) {
    try {
      await after(await api.transactions.reimport(b.id));
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Re-import failed", true);
    }
  }

  const unrecognized = lastScan?.unrecognized ?? [];
  // A scan left files it couldn't read, and the history (where they're listed) hasn't been opened since
  const warn = unrecognized.length > 0 && seenScan !== lastScan?.scannedAt;
  const lastImport = batches.find((b) => b.status === "imported");

  function openHistory() {
    setMenuOpen(false);
    setSheetOpen(false);
    setHistoryOpen(true);
    if (warn && lastScan) {
      setSeenScan(lastScan.scannedAt);
      try {
        localStorage.setItem(SEEN_KEY, lastScan.scannedAt);
      } catch {
        // The dot just comes back next visit
      }
    }
  }

  function pickFile() {
    setMenuOpen(false);
    setSheetOpen(false);
    fileRef.current?.click();
  }

  function runScan() {
    setMenuOpen(false);
    setSheetOpen(false);
    scan();
  }

  const icon = (d: string) => (
    <svg aria-hidden viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
  const dot = <span className="w-1.5 h-1.5 rounded-full bg-amber shrink-0" aria-hidden />;

  const items = [
    { id: "upload", icon: icon("M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"), label: "Upload statement…", onClick: pickFile },
    { id: "scan", icon: icon("M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.5H11"), label: busy ? "Working…" : "Scan statements folder", onClick: runScan },
    {
      id: "history",
      icon: icon("M2.5 4h11M2.5 8h11M2.5 12h7"),
      label: "Import history",
      hint: lastImport ? `Last import ${fmtDate(lastImport.importedAt.slice(0, 10))} · undo or re-import` : undefined,
      count: batches.length,
      onClick: openHistory,
    },
  ];

  return (
    <div ref={wrapRef} className="relative">
      <button
        className={`relative w-8 h-8 grid place-items-center border rounded-lg text-text-dim hover:border-accent hover:text-text transition-all ${
          menuOpen ? "border-accent text-text" : "border-border"
        }`}
        onClick={() => (isPhone() ? setSheetOpen(true) : setMenuOpen((o) => !o))}
        aria-label="Statements"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Statements"
      >
        <svg aria-hidden viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
        {warn && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber ring-2 ring-bg" aria-hidden />}
      </button>

      {/* Desktop: a small menu under the button */}
      {menuOpen && (
        <div role="menu" className="absolute right-0 top-full mt-1.5 z-40 w-[250px] p-1 bg-bg-card border border-border rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.45)] animate-[pillIn_0.12s_ease-out]">
          {items.map((it) => (
            <button
              key={it.id}
              role="menuitem"
              disabled={busy && it.id !== "history"}
              onClick={it.onClick}
              className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-[13px] hover:bg-white/[0.05] disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
            >
              <span className="flex-1">{it.label}</span>
              {it.id === "history" && warn && dot}
              {it.count != null && <span className="text-[11px] font-mono text-text-muted">{it.count}</span>}
            </button>
          ))}
          {lastImport && (
            <div className="border-t border-border mt-1 px-3 pt-2 pb-1.5 text-[11px] text-text-muted">
              Last import {fmtDate(lastImport.importedAt.slice(0, 10))}
            </div>
          )}
        </div>
      )}

      {/* Phones: the same three choices in a bottom sheet */}
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title="Statements">
        <div className="flex flex-col gap-1">
          {items.map((it) => (
            <button
              key={it.id}
              disabled={busy && it.id !== "history"}
              onClick={it.onClick}
              className="flex items-center gap-3 text-left px-3 py-3 rounded-lg text-sm font-medium text-text hover:bg-white/[0.04] disabled:opacity-50 transition-colors"
            >
              <span className="w-6 grid place-items-center text-text-dim">{it.icon}</span>
              <span className="min-w-0 flex-1">
                {it.label}
                {it.hint && <span className="block text-xs font-normal text-text-muted mt-0.5">{it.hint}</span>}
              </span>
              {it.id === "history" && warn && dot}
              {it.id === "history" && <span className="text-text-muted text-lg opacity-60">›</span>}
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Import history">
        <p className="text-xs text-text-muted mb-3 leading-relaxed">
          Bank CSVs and PDF statements in <span className="font-mono text-text-dim break-all" title={folder}>{folder.replace(/^\/Users\/[^/]+/, "~") || "…"}</span> are picked up automatically.
        </p>

        {unrecognized.length > 0 && (
          <div className="mb-3 text-xs bg-amber-dim text-amber rounded-lg px-3 py-2">
            {unrecognized.map((u) => (
              <div key={u.file}><span className="font-mono break-all">{u.file}</span>: {u.error}</div>
            ))}
          </div>
        )}

        {batches.length === 0 ? (
          <div className="text-xs text-text-muted py-2">Nothing imported yet.</div>
        ) : (
          <div className="flex flex-col">
            {batches.map((b) => (
              <div key={b.id} className={`flex items-center gap-3 text-xs py-2 border-b border-border/30 last:border-0 ${b.status === "undone" ? "opacity-50" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-text-dim" title={b.sourcePath || b.fileName}>{b.fileName}</div>
                  <div className="text-text-muted">
                    {fmtDate(b.importedAt.slice(0, 10))} · {b.dateFrom && b.dateTo ? `${fmtDate(b.dateFrom)} – ${fmtDate(b.dateTo)} · ` : ""}
                    {b.inserted} new, {b.duplicates} already had
                    {b.status === "undone" && " · undone"}
                  </div>
                </div>
                {b.status === "imported" ? (
                  b.inserted > 0 && <button className="btn btn-sm shrink-0" onClick={() => setUndoing(b)}>Undo</button>
                ) : (
                  <button className="btn btn-sm shrink-0" onClick={() => reimport(b)}>Re-import</button>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv,.pdf,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }}
      />

      <Confirm
        open={!!undoing}
        title="Undo Import?"
        message={undoing ? `Removes the ${undoing.inserted} transactions added from ${undoing.fileName}. The file stays in the folder but won't be imported again unless you choose Re-import.` : ""}
        confirmLabel="Remove"
        onConfirm={() => undoing && undo(undoing)}
        onCancel={() => setUndoing(null)}
      />
    </div>
  );
}
