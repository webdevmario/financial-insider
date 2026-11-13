import { useRef, useState } from "react";
import { api } from "../../lib/api";
import type { ScanResult } from "../../types";

interface ImportButtonProps {
  onToast: (msg: string, err?: boolean) => void;
  /** Called after anything changes the stored transactions */
  onChanged: () => void;
}

/** File → base64 (no data: prefix), in chunks so large PDFs don't overflow the call stack */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Import bank activity: CSV exports or PDF statements, several at once.
 * Files dropped in the watched folder on the server are imported too.
 */
export default function ImportButton({ onToast, onChanged }: ImportButtonProps) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList) {
    const list = [...files].filter((f) => /\.(csv|pdf)$/i.test(f.name));
    if (!list.length) return onToast("Choose a .csv or .pdf file", true);
    setBusy(true);
    const imported: ScanResult["imported"] = [];
    const failed: ScanResult["unrecognized"] = [];
    try {
      for (const f of list) {
        const r = /\.pdf$/i.test(f.name)
          ? await api.transactions.upload(f.name, await toBase64(f), "base64")
          : await api.transactions.upload(f.name, await f.text());
        imported.push(...r.imported);
        failed.push(...r.unrecognized);
      }
    } catch (err) {
      failed.push({ file: "", error: err instanceof Error ? err.message : "Import failed" });
    } finally {
      setBusy(false);
    }
    if (imported.length) onChanged();
    const added = imported.reduce((s, i) => s + i.inserted, 0);
    const msg = [
      imported.length ? `${added} new transaction${added === 1 ? "" : "s"}` : "",
      failed.length ? failed.map((u) => u.error).join(" · ") : "",
    ].filter(Boolean).join(" · ");
    onToast(msg || "Nothing new in that file", failed.length > 0 && !imported.length);
  }

  return (
    <>
      <button className="btn btn-sm inline-flex items-center gap-1.5" disabled={busy} onClick={() => fileRef.current?.click()}>
        <svg aria-hidden viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
        </svg>
        {busy ? "Importing…" : "Import"}
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
    </>
  );
}
