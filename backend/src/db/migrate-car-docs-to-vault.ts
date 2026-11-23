/**
 * One-time move of car documents to the vault (Papers), after the vault imported the files
 * (vault: pnpm vault:import-fi-cars, which writes the FI id -> vault id map).
 *
 *   node --import tsx src/db/migrate-car-docs-to-vault.ts [path/to/fi-car-docs-map.json]
 *
 * Fills car_documents from vehicle_documents, keyed by the vault ids (parents remapped too), then
 * renames vehicle_documents to vehicle_documents_old, kept for 30 days as the rollback. Rows FI had
 * skipped (not car documents) aren't in the vault and stay only in the old table. Run once; a second
 * run finds no vehicle_documents table and does nothing. Prints counts only.
 */
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { extname, join } from "path";
import { sqlite } from "./index.js";

const mapPath = process.argv[2] || join(homedir(), "Documents/development/projects/vault/data/fi-car-docs-map.json");

const has = (t: string) => !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
if (!has("vehicle_documents")) {
  console.log("No vehicle_documents table: already moved.");
  process.exit(0);
}
if (!existsSync(mapPath)) throw new Error(`map not found at ${mapPath}`);
const map = JSON.parse(readFileSync(mapPath, "utf8")) as Record<string, string>;

type Old = {
  id: string; file_name: string; status: string; vehicle_id: string | null; doc_type: string | null; date: string | null;
  vendor: string | null; odometer: number | null; total: number | null; summary: string | null; items: string | null;
  details: string | null; transaction_id: string | null; paid_outside: number; notes: string | null; parent_id: string | null;
  added_at: string; updated_at: string | null;
};
const rows = sqlite.prepare("SELECT * FROM vehicle_documents").all() as Old[];
const moving = rows.filter((r) => r.status !== "skipped");
const missing = moving.filter((r) => !map[r.id] || (r.parent_id && !map[r.parent_id]));
if (missing.length) throw new Error(`${missing.length} document(s) not in the vault map: ${missing.map((r) => r.id).join(", ")}`);

// The vault serves every one of these as a PDF (saved emails and photos were made into PDFs)
const pdfName = (name: string) => name.slice(0, name.length - extname(name).length) + ".pdf";

const insert = sqlite.prepare(`INSERT OR IGNORE INTO car_documents
  (id, file_name, status, vehicle_id, doc_type, date, vendor, odometer, total, summary, items, details,
   transaction_id, paid_outside, notes, parent_id, added_at, updated_at)
  VALUES (@id, @file_name, @status, @vehicle_id, @doc_type, @date, @vendor, @odometer, @total, @summary, @items, @details,
   @transaction_id, @paid_outside, @notes, @parent_id, @added_at, @updated_at)`);

sqlite.transaction(() => {
  for (const r of moving) {
    insert.run({ ...r, id: map[r.id], file_name: pdfName(r.file_name), parent_id: r.parent_id ? map[r.parent_id] : null });
  }
  sqlite.exec("ALTER TABLE vehicle_documents RENAME TO vehicle_documents_old");
})();

const n = (sqlite.prepare("SELECT count(*) AS n FROM car_documents").get() as { n: number }).n;
console.log(`Moved ${moving.length} of ${rows.length} documents (${rows.length - moving.length} skipped stay in vehicle_documents_old). car_documents holds ${n}.`);
