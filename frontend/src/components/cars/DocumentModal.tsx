import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDate, fmtP } from "../../lib/formatters";
import { DOC_TYPES, DOC_TYPE_LABELS } from "../../lib/cars";
import Modal from "../layout/Modal";
import MoneyInput from "../layout/MoneyInput";
import type { CarDocMatch, CarDocType, CarDocument, Vehicle } from "../../types";

interface DocumentModalProps {
  doc: CarDocument | null;
  cars: Vehicle[];
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, err?: boolean) => void;
}

const IMAGE = /\.(jpe?g|png|gif|webp)$/i;

/**
 * One document: the original next to what it says. /car-docs fills this in; here it can be
 * checked, corrected or entered by hand, and matched to the bank charge that paid it.
 */
export default function DocumentModal({ doc, cars, onClose, onSaved, onToast }: DocumentModalProps) {
  const [vehicleId, setVehicleId] = useState("");
  const [docType, setDocType] = useState<CarDocType | "">("");
  const [date, setDate] = useState("");
  const [vendor, setVendor] = useState("");
  const [odometer, setOdometer] = useState("");
  const [total, setTotal] = useState("");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [paidOutside, setPaidOutside] = useState(false);
  const [matches, setMatches] = useState<CarDocMatch[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setVehicleId(doc?.vehicleId || "");
    setDocType(doc?.docType || "");
    setDate(doc?.date || "");
    setVendor(doc?.vendor || "");
    setOdometer(doc?.odometer != null ? String(doc.odometer) : "");
    setTotal(doc?.total != null ? String(doc.total) : "");
    setSummary(doc?.summary || "");
    setNotes(doc?.notes || "");
    setTransactionId(doc?.transactionId || null);
    setPaidOutside(!!doc?.paidOutside);
    setMatches(null);
  }, [doc]);

  async function findMatches() {
    if (!doc) return;
    if (!date) return onToast("Add the date first", true);
    try {
      const r = await api.cars.matches(doc.id, { date, total: parseFloat(total) || null, vendor: vendor || null });
      setMatches(r.candidates);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Couldn't look for charges", true);
    }
  }

  async function save(status: "done" | "skipped" | "new") {
    if (!doc) return;
    if (status === "done" && !vehicleId && docType !== "insurance") return onToast("Pick the car", true);
    setSaving(true);
    try {
      await api.cars.updateDocument(doc.id, {
        status,
        vehicleId: vehicleId || null,
        docType: docType || null,
        date: date || null,
        vendor: vendor || null,
        odometer: odometer ? parseInt(odometer.replace(/[,\s]/g, ""), 10) : null,
        total: total ? parseFloat(total) : null,
        summary: summary || null,
        notes: notes || null,
        transactionId,
        paidOutside: transactionId ? false : paidOutside,
      });
      onToast(status === "skipped" ? "Marked as not a car document" : "Document saved");
      onSaved();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to save", true);
    } finally {
      setSaving(false);
    }
  }

  const fileUrl = doc ? api.cars.fileUrl(doc.id) : "";

  return (
    <Modal
      open={!!doc}
      onClose={onClose}
      variant="form"
      title={doc?.status === "new" ? "Read document" : "Document"}
      aside={
        doc && doc.status !== "skipped" && (
          <button className="btn btn-sm" onClick={() => save("skipped")} disabled={saving}>Not a car document</button>
        )
      }
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => save("done")} disabled={saving}>Save</button>
        </>
      }
    >
      {doc && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-text-dim truncate" title={doc.sourcePath}>{doc.fileName}</span>
            <a href={fileUrl} target="_blank" rel="noreferrer" className="link-tap shrink-0">Open original ↗</a>
          </div>
          {IMAGE.test(doc.fileName) && (
            <a href={fileUrl} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-border bg-black/20">
              <img src={fileUrl} alt={doc.fileName} className="w-full max-h-[260px] object-contain" />
            </a>
          )}

          <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
            <div className="input-group">
              <label>Car</label>
              <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">Not assigned</option>
                {cars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label>Type</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value as CarDocType)}>
                <option value="">Pick one</option>
                {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="input-group">
              <label>Shop / seller</label>
              <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </div>
            <div className="input-group">
              <label>Odometer</label>
              <input type="text" inputMode="numeric" placeholder="Miles" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
            </div>
            <div className="input-group">
              <label>Total paid</label>
              <MoneyInput value={total} onChange={setTotal} />
            </div>
          </div>
          <div className="input-group">
            <label>What was done</label>
            <input type="text" placeholder="e.g. Front brakes and rotors, cabin filter" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>

          {doc.items.length > 0 && (
            <div className="input-group">
              <label>Line items</label>
              <div className="bg-bg-input border border-border rounded-lg">
                {doc.items.map((it, i) => (
                  <div key={i} className="flex justify-between gap-3 px-3.5 py-2 text-xs border-b border-border/40 last:border-0">
                    <span className="text-text-dim">{it.description}</span>
                    {it.amount != null && <span className="font-mono shrink-0">{fmtP(it.amount)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="input-group">
            <label>Paid with</label>
            {transactionId ? (
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-bg-input border border-border rounded-lg text-xs">
                <span className="text-green">Matched to a bank charge</span>
                <button type="button" className="link-tap" onClick={() => setTransactionId(null)}>Unmatch</button>
              </div>
            ) : (
              <>
                <div className="flex gap-2 flex-wrap items-center">
                  <button type="button" className="btn btn-sm" onClick={findMatches}>Find the bank charge</button>
                  <label className="flex items-center gap-2 text-xs text-text-dim normal-case tracking-normal font-normal">
                    <input type="checkbox" checked={paidOutside} onChange={(e) => setPaidOutside(e.target.checked)} />
                    Paid in cash or from an account that isn't imported
                  </label>
                </div>
                {matches && (
                  <div className="bg-bg-input border border-border rounded-lg mt-1">
                    {matches.length === 0 && <div className="px-3.5 py-2.5 text-xs text-text-muted">No charge near that date and amount.</div>}
                    {matches.map((m) => (
                      <button
                        key={m.transactionId}
                        type="button"
                        onClick={() => { setTransactionId(m.transactionId); setPaidOutside(false); }}
                        className="w-full flex items-center justify-between gap-3 px-3.5 py-2 text-left text-xs border-b border-border/40 last:border-0 hover:bg-white/[0.03]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{m.merchant}</span>
                          <span className="text-text-muted">
                            {fmtDate(m.date)}
                            {m.exactAmount ? " · exact amount" : ""}
                            {m.otherDocumentId ? " · already has a document" : ""}
                          </span>
                        </span>
                        <span className="font-mono shrink-0">{fmtP(m.amount)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="input-group">
            <label>Notes</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      )}
    </Modal>
  );
}
