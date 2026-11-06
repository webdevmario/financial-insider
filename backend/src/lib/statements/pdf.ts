/**
 * PDF text extraction for bank statements, on this machine only (Mozilla's pdf.js).
 * Turns each page into lines of positioned text so readers can find columns.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfCell {
  x: number;
  text: string;
}

export interface PdfLine {
  page: number;
  y: number;
  cells: PdfCell[];
  /** Cells joined; a run of 2+ spaces separates cells that were visibly apart */
  text: string;
}

/** Text items on the same baseline (within ~2pt) form a line; lines run top to bottom */
export async function extractPdfLines(data: Uint8Array): Promise<PdfLine[]> {
  const doc = await getDocument({ data, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  const lines: PdfLine[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items
        .filter((it): it is typeof it & { str: string; transform: number[]; width: number } => "str" in it && typeof it.str === "string")
        .map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width, text: it.str }))
        .filter((it) => it.text.trim() !== "");

      const rows: { y: number; items: typeof items }[] = [];
      for (const it of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
        const row = rows.find((r) => Math.abs(r.y - it.y) <= 2);
        if (row) row.items.push(it);
        else rows.push({ y: it.y, items: [it] });
      }
      for (const row of rows.sort((a, b) => b.y - a.y)) {
        const sorted = row.items.sort((a, b) => a.x - b.x);
        // Merge items that touch into one cell; a visible gap starts a new cell
        const cells: (PdfCell & { end: number })[] = [];
        for (const it of sorted) {
          const last = cells[cells.length - 1];
          if (last && it.x - last.end < 4) {
            last.text += (it.x - last.end > 1 ? " " : "") + it.text;
            last.end = it.x + it.w;
          } else {
            cells.push({ x: it.x, text: it.text, end: it.x + it.w });
          }
        }
        const clean = cells.map((c) => ({ x: Math.round(c.x), text: c.text.replace(/\s+/g, " ").trim() })).filter((c) => c.text);
        if (clean.length) lines.push({ page: p, y: Math.round(row.y), cells: clean, text: clean.map((c) => c.text).join("  ") });
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return lines;
}
