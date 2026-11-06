import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { fmtDate } from "../../lib/formatters";
import type { ImportBatch, ScanResult } from "../../types";

interface ImportPanelProps {
  onToast: (msg: string, err?: boolean) => void;
  /** Called after anything changes the stored transactions */
  onChanged: () => void;
}

function describeScan(r: ScanResult): string {
  const added = r.imported.reduce((s, i) => s + i.inserted, 0);
  if (!r.imported.length && !r.unrecognized.length) return "No new files";
  const parts = [];
  if (r.imported.length) parts.push(`${r.imported.length} file${r.imported.length === 1 ? "" : "s"} · ${added} new transactions`);
  if (r.unrecognized.length) parts.push(`${r.unrecognized.length} not recognized`);
  return parts.join(" · ");
}

export default function ImportPanel({ onToast, onChanged }: ImportPanelProps) {
  const [folder, setFolder] = useState("");
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
    const list = [...files].filter((f) => /\.csv$/i.test(f.name));
    if (!list.length) return onToast("Choose a .csv file", true);
    setBusy(true);
    try {
      let last: ScanResult | null = null;
      const combined: ScanResult = { scannedAt: "", folder, imported: [], skipped: 0, unrecognized: [] };
      for (const f of list) {
        last = await api.transactions.upload(f.name, await f.text());
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
    if (!confirm(`Remove the ${b.inserted} transactions added from ${b.fileName}? The file stays in the folder but won't be imported again unless you choose Re-import.`)) return;
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

  const lastImport = batches.find((b) => b.status === "imported");

  return (
    <div
      className={`bg-bg-card border rounded-xl p-4 mb-6 transition-colors ${dragging ? "border-accent bg-accent/[0.06]" : "border-border"}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files); }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Statements folder</div>
          <div className="text-[11px] text-text-muted truncate" title={folder}>
            Drop bank CSVs into <span className="font-mono text-text-dim">{folder || "…"}</span> or onto this box. They're picked up automatically.
            {lastImport && <> · Last import {fmtDate(lastImport.importedAt.slice(0, 10))}</>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide imports" : `Imports (${batches.length})`}
          </button>
          <button className="btn btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>Upload CSV</button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={scan}>{busy ? "Working…" : "Scan folder"}</button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }}
          />
        </div>
      </div>

      {lastScan && lastScan.unrecognized.length > 0 && (
        <div className="mt-3 text-xs bg-amber-dim text-amber rounded-lg px-3 py-2">
          {lastScan.unrecognized.map((u) => (
            <div key={u.file}><span className="font-mono">{u.file}</span>: {u.error}</div>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-4 border-t border-border pt-3 flex flex-col gap-1 max-h-[320px] overflow-y-auto">
          {batches.length === 0 ? (
            <div className="text-xs text-text-muted py-2">Nothing imported yet.</div>
          ) : (
            batches.map((b) => (
              <div key={b.id} className={`flex items-center gap-3 text-xs py-1.5 border-b border-border/30 last:border-0 ${b.status === "undone" ? "opacity-50" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-text-dim" title={b.sourcePath || b.fileName}>{b.fileName}</div>
                  <div className="text-text-muted">
                    {fmtDate(b.importedAt.slice(0, 10))} · {b.dateFrom && b.dateTo ? `${fmtDate(b.dateFrom)} – ${fmtDate(b.dateTo)} · ` : ""}
                    {b.inserted} new, {b.duplicates} already had
                    {b.status === "undone" && " · undone"}
                  </div>
                </div>
                {b.status === "imported" ? (
                  b.inserted > 0 && <button className="btn btn-sm" onClick={() => undo(b)}>Undo</button>
                ) : (
                  <button className="btn btn-sm" onClick={() => reimport(b)}>Re-import</button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
