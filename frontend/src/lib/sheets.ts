import { useSyncExternalStore } from "react";

/**
 * Every open sheet (Modal), bottom to top. Owns the plumbing they share:
 *
 * - Escape and the browser/Android Back button close the top sheet only.
 *   While any sheet is open, one extra history entry sits on top, so Back
 *   pops it (closing the sheet) instead of leaving the app.
 * - The top sheet's message slot, where toasts render on phones so the
 *   keyboard and the action bar can't hide them.
 */

interface Sheet {
  id: string;
  /** Asks the sheet to close; it may prompt to discard edits instead */
  close: () => void;
  slot: HTMLElement | null;
}

const sheets: Sheet[] = [];
const listeners = new Set<() => void>();
/** Our history entry is the current one */
let guarded = false;
/** history.back() calls of our own whose popstate should be ignored */
let ignorePops = 0;

function emit() {
  listeners.forEach((l) => l());
}

function ensureGuard() {
  if (guarded) return;
  history.pushState({ fiSheet: true }, "");
  guarded = true;
}

export function registerSheet(id: string, close: () => void): () => void {
  sheets.push({ id, close, slot: null });
  ensureGuard();
  emit();
  return () => {
    const i = sheets.findIndex((s) => s.id === id);
    if (i >= 0) sheets.splice(i, 1);
    emit();
    // Deferred: closing one sheet and opening another in the same tap
    // (a menu that opens Settings) shouldn't drop and re-add the entry
    setTimeout(() => {
      if (sheets.length === 0 && guarded) {
        guarded = false;
        ignorePops++;
        history.back();
      }
    }, 0);
  };
}

export function updateSheetClose(id: string, close: () => void) {
  const s = sheets.find((x) => x.id === id);
  if (s) s.close = close;
}

export function setSheetSlot(id: string, slot: HTMLElement | null) {
  const s = sheets.find((x) => x.id === id);
  if (!s || s.slot === slot) return;
  s.slot = slot;
  emit();
}

/** 0 for the bottom sheet, 1 for one stacked on it, … */
export function sheetDepth(id: string): number {
  return sheets.findIndex((s) => s.id === id);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Where a toast should render: inside the top sheet, or null when none is open */
export function useTopSheetSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => sheets[sheets.length - 1]?.slot ?? null);
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (ignorePops > 0) {
      ignorePops--;
      return;
    }
    if (!guarded) return;
    guarded = false;
    sheets[sheets.length - 1]?.close();
    // Something is still open (a lower sheet, or a "Discard changes?" prompt): keep Back working
    setTimeout(() => {
      if (sheets.length > 0) ensureGuard();
    }, 0);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheets.length > 0) sheets[sheets.length - 1].close();
  });
}
