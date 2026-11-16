/**
 * Car documents folder: receipts, repair invoices, bills of sale, insurance pages, registration.
 *
 * Drop files anywhere in the folder (default ~/Documents/car-documents, override with CAR_DOCS_DIR),
 * or upload them in the app (saved under uploads/). Each file's sha256 is recorded, so a scan only adds
 * files it hasn't seen, and a file that moved keeps its record. Nothing here reads what a document
 * says: Claude does that with the /car-docs skill and saves the details through the API. Once a document
 * is read and assigned to a car, a loose file is filed away as <car>/<year>/<date> <vendor> <type>.<ext>
 * (set CAR_DOCS_ORGANIZE=0 to leave files in place). File contents are never changed.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, watch, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, dirname, extname, join, relative, resolve, sep } from "path";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { vehicleDocuments, vehicles, type VehicleDocument } from "../../db/schema.js";

export function carDocsDir(): string {
  return resolve(process.env.CAR_DOCS_DIR || join(homedir(), "Documents", "car-documents"));
}

/** Files worth keeping: documents, photos of receipts, saved emails */
export const DOC_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".gif", ".tif", ".tiff", ".txt", ".eml", ".html", ".htm", ".md", ".csv", ".doc", ".docx"];

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".heic": "image/heic", ".heif": "image/heif", ".webp": "image/webp", ".gif": "image/gif",
  ".tif": "image/tiff", ".tiff": "image/tiff", ".txt": "text/plain; charset=utf-8",
  ".eml": "message/rfc822", ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".md": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function contentType(fileName: string): string {
  return CONTENT_TYPES[extname(fileName).toLowerCase()] || "application/octet-stream";
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Absolute path of a document's file, or null if it points outside the folder */
export function documentPath(doc: Pick<VehicleDocument, "sourcePath">): string | null {
  const folder = carDocsDir();
  const full = resolve(folder, doc.sourcePath);
  return full === folder || !full.startsWith(folder + sep) ? null : full;
}

/** Every document file under the folder, skipping hidden files and macOS metadata */
function listFiles(folder: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && DOC_EXTENSIONS.includes(extname(e.name).toLowerCase())) out.push(full);
    }
  };
  walk(folder);
  return out;
}

export interface DocScanResult {
  added: number;
  moved: number;
  /** Documents whose file is no longer in the folder */
  missing: number;
  newDocs: number;
}

let scanning = false;

/** Record files the folder has that the database doesn't, and follow files that moved */
export function scanCarDocs(): DocScanResult {
  const result: DocScanResult = { added: 0, moved: 0, missing: 0, newDocs: 0 };
  if (scanning) return result;
  scanning = true;
  try {
    const folder = carDocsDir();
    mkdirSync(folder, { recursive: true });
    const known = db.select().from(vehicleDocuments).all();
    const byHash = new Map(known.map((d) => [d.fileHash, d]));
    const byPath = new Map(known.map((d) => [d.sourcePath, d]));
    const seenPaths = new Set<string>();
    const now = new Date().toISOString();

    for (const full of listFiles(folder)) {
      const rel = relative(folder, full);
      seenPaths.add(rel);
      const existing = byPath.get(rel);
      const size = statSync(full).size;
      // Same path and size as before: skip hashing, the file hasn't changed
      if (existing && existing.size === size) continue;
      const hash = createHash("sha256").update(readFileSync(full)).digest("hex");
      const match = byHash.get(hash);
      if (existing && !match) {
        // Same file, new contents (re-saved in place): keep the record, follow the bytes
        db.update(vehicleDocuments).set({ fileHash: hash, size }).where(eq(vehicleDocuments.id, existing.id)).run();
        byHash.set(hash, existing);
        continue;
      }
      if (match) {
        if (match.sourcePath !== rel && !existsSync(resolve(folder, match.sourcePath))) {
          db.update(vehicleDocuments).set({ sourcePath: rel, fileName: basename(full) }).where(eq(vehicleDocuments.id, match.id)).run();
          match.sourcePath = rel;
          result.moved++;
        }
        continue; // A copy of a file already recorded
      }
      const row = {
        id: newId(), fileName: basename(full), sourcePath: rel, fileHash: hash, size,
        status: "new", paidOutside: 0, addedAt: now,
      };
      db.insert(vehicleDocuments).values(row).run();
      byHash.set(hash, row as VehicleDocument);
      result.added++;
    }

    result.missing = known.filter((d) => !seenPaths.has(d.sourcePath) && !existsSync(resolve(folder, d.sourcePath))).length;
    result.newDocs = db.select({ id: vehicleDocuments.id }).from(vehicleDocuments).where(eq(vehicleDocuments.status, "new")).all().length;
    if (result.added || result.moved) {
      console.log(`${new Date().toISOString()} Car documents: ${result.added} added, ${result.moved} moved, ${result.newDocs} waiting to be read`);
    }
  } finally {
    scanning = false;
  }
  return result;
}

/** Save an upload from the app (base64) into uploads/ and record it */
export function saveCarDocUpload(fileName: string, base64: string): { doc: VehicleDocument | null; duplicate: boolean } {
  const safe = basename(fileName).replace(/[^\w .()-]/g, "_") || "document";
  if (!DOC_EXTENSIONS.includes(extname(safe).toLowerCase())) {
    throw new Error(`Can't keep ${extname(safe) || "files without an extension"}: use a PDF, photo or text file`);
  }
  const bytes = Buffer.from(base64, "base64");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const existing = db.select().from(vehicleDocuments).where(eq(vehicleDocuments.fileHash, hash)).get();
  if (existing) return { doc: existing, duplicate: true };
  const dir = join(carDocsDir(), "uploads");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  writeFileSync(join(dir, `${stamp} ${safe}`), bytes);
  scanCarDocs();
  return { doc: db.select().from(vehicleDocuments).where(eq(vehicleDocuments.fileHash, hash)).get() ?? null, duplicate: false };
}

const organizing = () => process.env.CAR_DOCS_ORGANIZE !== "0";

/** Dropped at the top of the folder, or uploaded from the app: not filed anywhere yet */
function isLoose(rel: string): boolean {
  const parts = rel.split(sep);
  return parts.length === 1 || (parts.length === 2 && parts[0] === "uploads");
}

const cleanName = (s: string) => s.replace(/[^\w .()&'-]/g, "").replace(/\s+/g, " ").trim();

/**
 * Move a read document to <car>/<year>/<date> <vendor> <type>.<ext>. Only loose files move;
 * anything the user filed in a subfolder themselves stays put.
 */
export function fileAwayDocument(id: string): void {
  if (!organizing()) return;
  const doc = db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, id)).get();
  if (!doc || doc.status !== "done" || !doc.vehicleId || !isLoose(doc.sourcePath)) return;
  const car = db.select().from(vehicles).where(eq(vehicles.id, doc.vehicleId)).get();
  const from = documentPath(doc);
  if (!car || !from || !existsSync(from)) return;
  const folder = carDocsDir();
  const ext = extname(from).toLowerCase();
  const year = doc.date?.slice(0, 4) || "undated";
  const stem = cleanName([doc.date, doc.vendor, doc.docType].filter(Boolean).join(" ")) || cleanName(basename(from, ext));
  const dir = join(folder, cleanName(car.name) || "car", year);
  let target = join(dir, stem + ext);
  for (let n = 2; existsSync(target); n++) target = join(dir, `${stem} (${n})${ext}`);
  try {
    mkdirSync(dirname(target), { recursive: true });
    renameSync(from, target);
  } catch (err) {
    console.error(`${new Date().toISOString()} Couldn't file ${doc.sourcePath}: ${(err as Error).message}`);
    return;
  }
  db.update(vehicleDocuments)
    .set({ sourcePath: relative(folder, target), fileName: basename(target) })
    .where(eq(vehicleDocuments.id, id))
    .run();
}

/**
 * Scan on startup, then whenever the folder changes (debounced, so a file that lands in
 * several writes is read once it's finished). Set CAR_DOCS_WATCH=0 to turn this off.
 */
export function watchCarDocs() {
  if (process.env.CAR_DOCS_WATCH === "0") return;
  const folder = carDocsDir();
  try {
    mkdirSync(folder, { recursive: true });
  } catch (err) {
    console.error(`Car documents folder unavailable (${folder}): ${(err as Error).message}`);
    return;
  }
  const run = () => {
    try {
      scanCarDocs();
    } catch (err) {
      console.error(`${new Date().toISOString()} Car documents scan failed: ${(err as Error).message}`);
    }
  };
  let timer: NodeJS.Timeout | null = null;
  const schedule = (delay: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delay);
  };
  try {
    watch(folder, { recursive: true }, () => schedule(3000));
    console.log(`  🚗 Watching car documents folder: ${folder}`);
  } catch (err) {
    console.error(`Can't watch ${folder}: ${(err as Error).message}`);
  }
  schedule(800);
}
