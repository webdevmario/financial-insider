/**
 * Scan cleanup for car documents. A phone photo of a receipt (or a PDF of several) becomes what a
 * flatbed scanner would have made: cropped to the paper, upright, straight, Letter-sized when it's a
 * Letter sheet, white paper with dark text, a fraction of the size, and searchable, with the text read by
 * OCR kept on the document so the /car-docs skill (and the app) can read it without guessing at pixels.
 *
 * The work is done by tools/doc-clean.swift, which uses only what ships with macOS (Vision, Core Image),
 * compiled on first use into backend/.bin. The original file is never changed: it moves to
 * <folder>/.originals/<hash>.<ext> (hidden, so the folder scan skips it), and restoreOriginal puts it
 * back. A PDF that already has real text (an emailed invoice) and a photo with no text on it (a dent,
 * the odometer) are left exactly as they are.
 *
 * New photos and scanned PDFs are cleaned automatically as they arrive (CAR_DOCS_CLEAN=0 turns that off).
 * One file holding several documents is split with cleanDocument(id, { pages: "1;2-5" }).
 */
import { execFile } from "child_process";
import { createHash } from "crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, extname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { vehicleDocuments, type VehicleDocument } from "../../db/schema.js";
import { carDocsDir, documentPath, folderPath } from "./folder.js";

const run = promisify(execFile);
const TOOL = resolve(dirname(fileURLToPath(import.meta.url)), "../../../tools/doc-clean.swift");
const BIN = resolve(dirname(TOOL), "../.bin/doc-clean");

/** Kinds of file that can be a photo or scan of paper */
const CLEANABLE = [".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff"];
export const isCleanable = (fileName: string) => CLEANABLE.includes(extname(fileName).toLowerCase());

/** Fewer characters than this across all pages: a photo of the car, not of paper */
const MIN_TEXT = 40;

export interface PageReport {
  page: number;
  chars: number;
  text: string;
  cropped?: boolean;
  edgeWhitened?: number;
  turned?: number;
  tilt?: number;
  letter?: boolean;
  blank?: boolean;
  similarTo?: number[];
}

interface ToolReport {
  digital: boolean;
  inputBytes?: number;
  seconds?: number;
  mode?: string;
  pages: PageReport[];
  parts: { file: string; pages: number[]; bytes: number; text: string }[];
}

export interface CleanOptions {
  /** Split into several documents: page groups separated by ";", e.g. "1;2-5". Pages left out are dropped */
  pages?: string;
  /** gray (default), bw (pure black and white, smallest) or color (geometry only) */
  mode?: "gray" | "bw" | "color";
  /** Extra clockwise turn for pages auto-orientation got wrong, e.g. "3:90,4:180" */
  rotate?: string;
  /** false: don't crop or whiten edges (a sheet with dark artwork running off the page) */
  crop?: boolean;
  /** Clean a PDF even though it already has a text layer */
  force?: boolean;
}

/** What's stored in vehicle_documents.cleanup */
export interface CleanupRecord {
  at: string;
  /** digital: had its own text, left alone. photo: no text, left alone. cleaned. restored. failed */
  result: "cleaned" | "digital" | "photo" | "restored" | "failed";
  originalName?: string;
  originalBytes?: number;
  bytes?: number;
  mode?: string;
  /** Which pages of the original this document is, when the original was split */
  pages?: number[];
  part?: number;
  partsTotal?: number;
  report?: Omit<PageReport, "text">[];
  error?: string;
}

let building: Promise<string> | null = null;

/** The compiled cleaner, built from source the first time (and again whenever the source changes) */
async function cleaner(): Promise<string> {
  if (existsSync(BIN) && statSync(BIN).mtimeMs >= statSync(TOOL).mtimeMs) return BIN;
  building ??= (async () => {
    mkdirSync(dirname(BIN), { recursive: true });
    const tmp = `${BIN}.${process.pid}.tmp`;
    try {
      await run("swiftc", ["-O", "-swift-version", "5", TOOL, "-o", tmp], { timeout: 600_000 });
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string };
      if (e.code === "ENOENT") throw new Error("Scan cleanup needs the Xcode command line tools: run xcode-select --install");
      throw new Error(`Couldn't build the scan cleaner: ${(e.stderr || e.message).slice(0, 500)}`);
    }
    renameSync(tmp, BIN);
    return BIN;
  })().finally(() => {
    building = null;
  });
  return building;
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function findDoc(id: string) {
  return db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, id)).get();
}

function parseCleanup(d: VehicleDocument): CleanupRecord | null {
  try {
    return d.cleanup ? (JSON.parse(d.cleanup) as CleanupRecord) : null;
  } catch {
    return null;
  }
}

/** A free file name in dir: "name.pdf", else "name (2).pdf", ... */
function freePath(dir: string, fileName: string): string {
  const ext = extname(fileName), stem = basename(fileName, ext);
  let target = join(dir, fileName);
  for (let n = 2; existsSync(target); n++) target = join(dir, `${stem} (${n})${ext}`);
  return target;
}

/** Other documents split out of the same original */
function siblingsOf(doc: VehicleDocument): VehicleDocument[] {
  if (!doc.originalPath) return [];
  return db.select().from(vehicleDocuments).where(eq(vehicleDocuments.originalPath, doc.originalPath)).all()
    .filter((d) => d.id !== doc.id);
}

/** Drop split-off parts that haven't been read yet, files and all; refuse if any has been */
function dropSiblings(doc: VehicleDocument, action: string) {
  const siblings = siblingsOf(doc);
  const read = siblings.filter((s) => s.status !== "new");
  if (read.length) {
    throw new Error(`Can't ${action}: ${read.map((s) => s.fileName).join(", ")} came from the same file and has already been read`);
  }
  for (const s of siblings) {
    const p = documentPath(s);
    if (p && existsSync(p)) unlinkSync(p);
    db.delete(vehicleDocuments).where(eq(vehicleDocuments.id, s.id)).run();
  }
}

function validate(o: CleanOptions) {
  if (o.pages != null && !/^[\d\s,;-]+$/.test(o.pages)) throw new Error('pages looks like "1;2-5": groups split by ;');
  if (o.rotate != null && !/^[\d\s,:]+$/.test(o.rotate)) throw new Error('rotate looks like "3:90,4:180"');
  if (o.mode != null && !["gray", "bw", "color"].includes(o.mode)) throw new Error("mode is gray, bw or color");
}

export interface CleanResult {
  result: CleanupRecord["result"];
  /** The document and any split off from it, in page order */
  documents: VehicleDocument[];
  pages: PageReport[];
}

/**
 * Clean up a document's file (from its original, when it was cleaned before). Re-running with new
 * options redoes it from the original; parts split off earlier that nobody has read yet are replaced.
 */
export async function cleanDocument(id: string, options: CleanOptions = {}): Promise<CleanResult> {
  validate(options);
  const doc = findDoc(id);
  if (!doc) throw new Error("Not found");
  const input = doc.originalPath ? folderPath(doc.originalPath) : documentPath(doc);
  const originalName = parseCleanup(doc)?.originalName ?? doc.fileName;
  if (!isCleanable(originalName)) throw new Error("Only PDFs and photos can be cleaned up");
  if (!input || !existsSync(input)) throw new Error("The file isn't in the car documents folder any more");

  const bin = await cleaner();
  const out = mkdtempSync(join(tmpdir(), "doc-clean-"));
  try {
    const stem = basename(doc.fileName, extname(doc.fileName)).replace(/ \(\d+ of \d+\)$/, "") || "document";
    const args = [input, out, "--name", stem];
    if (options.pages) args.push("--pages", options.pages);
    if (options.mode) args.push("--mode", options.mode);
    if (options.rotate) args.push("--rotate", options.rotate);
    if (options.crop === false) args.push("--no-crop");
    if (options.force) args.push("--force");
    let report: ToolReport;
    try {
      const { stdout } = await run(bin, args, { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
      report = JSON.parse(stdout) as ToolReport;
    } catch (err) {
      const e = err as Error & { stderr?: string };
      throw new Error(`Scan cleanup failed: ${(e.stderr || e.message).trim().slice(0, 500)}`);
    }
    // Re-read: the tool takes a few seconds and the folder scan may have moved things meanwhile
    const fresh = findDoc(id);
    if (!fresh) throw new Error("The document was removed while it was being cleaned");
    const now = new Date().toISOString();
    const allText = report.pages.map((p) => p.text).join("\n\n").trim();

    // Nothing to clean: keep the file, keep what it says
    const untouched: CleanupRecord["result"] | null =
      report.digital ? "digital" : allText.replace(/\s/g, "").length < MIN_TEXT && !options.force ? "photo" : null;
    if (untouched) {
      const record: CleanupRecord = { at: now, result: untouched };
      db.update(vehicleDocuments)
        .set({ text: allText || null, cleanup: JSON.stringify(record) })
        .where(eq(vehicleDocuments.id, id)).run();
      return { result: untouched, documents: [findDoc(id)!], pages: report.pages };
    }

    dropSiblings(fresh, "split it again");
    const folder = carDocsDir();
    const current = documentPath(fresh);
    if (!current) throw new Error("The file isn't in the car documents folder any more");
    const dir = dirname(current);

    // Keep the original once, out of the scan's way; a cleaned file from an earlier run is replaced
    let originalPath = fresh.originalPath;
    const originalHash = fresh.originalHash ?? fresh.fileHash;
    let originalBytes = report.inputBytes;
    if (!originalPath) {
      const kept = join(folder, ".originals", `${fresh.fileHash}${extname(current).toLowerCase()}`);
      mkdirSync(dirname(kept), { recursive: true });
      if (existsSync(kept)) unlinkSync(current);
      else renameSync(current, kept);
      originalPath = relative(folder, kept);
    } else if (existsSync(current)) {
      unlinkSync(current);
    }

    const pageReport = (n: number) => {
      const { text: _text, ...rest } = report.pages[n - 1] ?? ({ page: n } as PageReport);
      return rest;
    };
    const documents: VehicleDocument[] = [];
    report.parts.forEach((part, i) => {
      const target = freePath(dir, basename(part.file));
      copyFileSync(part.file, target);
      const hash = sha256(target);
      const size = statSync(target).size;
      const record: CleanupRecord = {
        at: now, result: "cleaned", originalName, originalBytes, bytes: size, mode: report.mode,
        pages: part.pages, report: part.pages.map(pageReport),
        ...(report.parts.length > 1 ? { part: i + 1, partsTotal: report.parts.length } : {}),
      };
      const fields = {
        fileName: basename(target), sourcePath: relative(folder, target), fileHash: hash, size,
        text: part.text || null, originalPath, originalHash, cleanup: JSON.stringify(record),
      };
      const clash = db.select().from(vehicleDocuments).where(eq(vehicleDocuments.fileHash, hash)).get();
      if (clash && clash.id !== id) {
        unlinkSync(target); // Identical to a document already recorded
        return;
      }
      if (i === 0) {
        db.update(vehicleDocuments).set(fields).where(eq(vehicleDocuments.id, id)).run();
        documents.push(findDoc(id)!);
      } else {
        const row = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          ...fields, status: "new", paidOutside: 0, addedAt: now,
        };
        db.insert(vehicleDocuments).values(row).run();
        documents.push(findDoc(row.id)!);
      }
    });
    return { result: "cleaned", documents, pages: report.pages };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** Undo cleanup: the original goes back where the cleaned file was, and stays (no automatic re-clean) */
export function restoreOriginal(id: string): VehicleDocument {
  const doc = findDoc(id);
  if (!doc) throw new Error("Not found");
  if (!doc.originalPath) throw new Error("This document hasn't been cleaned up; it's already the original");
  const original = folderPath(doc.originalPath);
  if (!original || !existsSync(original)) throw new Error("The original file is missing from .originals");
  dropSiblings(doc, "restore the original");
  const folder = carDocsDir();
  const current = documentPath(doc);
  const dir = current ? dirname(current) : folder;
  const name = parseCleanup(doc)?.originalName ?? basename(original);
  if (current && existsSync(current)) unlinkSync(current);
  const target = freePath(dir, name);
  renameSync(original, target);
  const record: CleanupRecord = { at: new Date().toISOString(), result: "restored", originalName: name };
  db.update(vehicleDocuments).set({
    fileName: basename(target), sourcePath: relative(folder, target), fileHash: doc.originalHash ?? sha256(target),
    size: statSync(target).size, originalPath: null, originalHash: null, cleanup: JSON.stringify(record),
  }).where(eq(vehicleDocuments.id, id)).run();
  return findDoc(id)!;
}

// ── Automatic cleanup of new arrivals ─────────────────────────────

const queue = new Set<string>();
let draining = false;

const autoCleaning = () => process.env.CAR_DOCS_CLEAN !== "0";

/** Queue every unread photo or scan that hasn't been through cleanup yet */
export function queueNewDocuments() {
  if (!autoCleaning()) return;
  const waiting = db.select().from(vehicleDocuments)
    .where(and(eq(vehicleDocuments.status, "new"), isNull(vehicleDocuments.cleanup))).all()
    .filter((d) => isCleanable(d.fileName));
  for (const d of waiting) queue.add(d.id);
  if (queue.size) void drain();
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.size) {
      const id = queue.values().next().value as string;
      queue.delete(id);
      const doc = findDoc(id);
      if (!doc || doc.status !== "new" || doc.cleanup) continue;
      try {
        const r = await cleanDocument(id);
        if (r.result === "cleaned") {
          const rec = parseCleanup(r.documents[0]);
          const mb = (n?: number) => ((n ?? 0) / 1_048_576).toFixed(1);
          console.log(`${new Date().toISOString()} Cleaned up ${rec?.originalName}: ${r.pages.length} pages, ${mb(rec?.originalBytes)} MB to ${mb(rec?.bytes)} MB`);
        }
      } catch (err) {
        const message = (err as Error).message;
        console.error(`${new Date().toISOString()} Couldn't clean up ${doc.fileName}: ${message}`);
        // Recorded so it isn't retried on every scan; POST .../clean tries again
        const record: CleanupRecord = { at: new Date().toISOString(), result: "failed", error: message };
        db.update(vehicleDocuments).set({ cleanup: JSON.stringify(record) }).where(eq(vehicleDocuments.id, id)).run();
      }
    }
  } finally {
    draining = false;
  }
}
