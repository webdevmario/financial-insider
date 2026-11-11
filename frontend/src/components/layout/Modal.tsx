import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import IconButton from "./IconButton";
import { registerSheet, setSheetSlot, sheetDepth, updateSheetClose } from "../../lib/sheets";

/**
 * - form:    fields with Cancel and Save. Full-width buttons on phones, and
 *            dismissing after any edit asks "Discard changes?"
 * - list:    a short list of choices; picking one closes the sheet
 * - detail:  a tall sheet to browse and act in (tabs, long lists)
 * - confirm: a yes/no question; stacked full-width buttons on phones
 */
export type SheetVariant = "form" | "list" | "detail" | "confirm";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  titleExtra?: React.ReactNode;
  /** Action buttons. Pinned under the scrolling content so they stay in reach on a phone. */
  footer?: React.ReactNode;
  variant?: SheetVariant;
  /**
   * A secondary action such as Delete. Left end of the footer on desktop; on
   * phones a full-width button at the end of the content, away from Save.
   */
  aside?: React.ReactNode;
  /**
   * Unsaved changes: swipe, backdrop, Back, Escape and ✕ ask before closing.
   * Form sheets work this out themselves (any edit in the sheet counts);
   * pass it to override.
   */
  dirty?: boolean;
  /** Extra classes for the dialog panel, such as a fixed height for tabbed content */
  className?: string;
  children: React.ReactNode;
}

// ── Background scroll lock ───────────────────────────────────────
// Pinning <body> with position: fixed is the only lock iOS Safari honours
// (overflow: hidden alone still lets the page scroll under a touch).
// Counted, so stacked modals don't unlock each other.
let lockCount = 0;
let savedScrollY = 0;
let savedBodyStyle = "";

function lockScroll() {
  if (lockCount++ > 0) return;
  savedScrollY = window.scrollY;
  savedBodyStyle = document.body.getAttribute("style") ?? "";
  Object.assign(document.body.style, {
    position: "fixed",
    top: `-${savedScrollY}px`,
    left: "0",
    right: "0",
    overflow: "hidden",
  });
}

function unlockScroll() {
  if (--lockCount > 0) return;
  document.body.setAttribute("style", savedBodyStyle);
  window.scrollTo(0, savedScrollY);
}

/**
 * The part of the screen not covered by the on-screen keyboard. iOS doesn't
 * shrink the layout viewport for the keyboard, so a sheet pinned to bottom: 0
 * would end up behind it; sizing the overlay to the visual viewport keeps the
 * sheet (and its focused input) above the keyboard.
 */
function useVisibleArea(active: boolean) {
  const [area, setArea] = useState<{ top: number; height: number; keyboard: boolean } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const update = () =>
      setArea({ top: vv.offsetTop, height: vv.height, keyboard: window.innerHeight - vv.height > 120 });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);
  return area;
}

const isPhone = () => window.matchMedia("(max-width: 767px)").matches;

/** Distance, or a quick flick, that dismisses a dragged sheet */
const DISMISS_PX = 90;
const FLICK_PX = 40;
const FLICK_MS = 250;

/**
 * Shared dialog: centred card on desktop, bottom sheet on phones.
 * The header and footer stay put; only the content between them scrolls.
 */
export default function Modal({
  open, onClose, title, titleExtra, footer, variant = "detail", aside, dirty, className = "", children,
}: ModalProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const [asking, setAsking] = useState(false);
  const [depth, setDepth] = useState(0);
  const area = useVisibleArea(open);

  const isDirty = () => dirty ?? (variant === "form" && touched.current);
  /** Every dismissal except an explicit Cancel goes through here */
  const requestClose = () => {
    if (isDirty()) setAsking(true);
    else onClose();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Open: lock the page, join the sheet stack (Escape, Back, toasts), watch for edits
  useEffect(() => {
    if (!open) return;
    const returnFocus = document.activeElement as HTMLElement | null;
    touched.current = false;
    setAsking(false);
    lockScroll();
    const leave = registerSheet(id, () => requestCloseRef.current());
    setSheetSlot(id, slotRef.current);
    setDepth(sheetDepth(id));

    const body = bodyRef.current;
    const onEdit = () => {
      touched.current = true;
    };
    body?.addEventListener("input", onEdit);
    body?.addEventListener("change", onEdit);
    return () => {
      body?.removeEventListener("input", onEdit);
      body?.removeEventListener("change", onEdit);
      leave();
      unlockScroll();
      returnFocus?.focus?.({ preventScroll: true });
    };
  }, [open, id]);

  useEffect(() => {
    if (open) updateSheetClose(id, () => requestCloseRef.current());
  });

  // Focus the first field on desktop. On phones that would pop the keyboard
  // over the sheet before the user has seen it, so leave it to them.
  useEffect(() => {
    if (!open || window.matchMedia("(pointer: coarse)").matches) return;
    const t = setTimeout(() => {
      bodyRef.current
        ?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled])")
        ?.focus();
    }, 100);
    return () => clearTimeout(t);
  }, [open]);

  // Drag down to dismiss (phones): from the header, or from the content when
  // it's scrolled to the top. Native listeners, since React's touchmove is
  // passive and can't stop the page from bouncing under the drag.
  useEffect(() => {
    const panel = panelRef.current;
    const body = bodyRef.current;
    if (!open || !panel || !body) return;
    let drag: { x: number; y: number; t: number; fromHeader: boolean; engaged: boolean; dy: number } | null = null;

    const onStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!isPhone() || e.touches.length !== 1 || target.closest("textarea, [data-no-drag]")) return;
      const t = e.touches[0];
      drag = {
        x: t.clientX, y: t.clientY, t: Date.now(),
        fromHeader: !!headerRef.current?.contains(target),
        engaged: false, dy: 0,
      };
    };
    const onMove = (e: TouchEvent) => {
      if (!drag) return;
      const t = e.touches[0];
      const dx = t.clientX - drag.x;
      const dy = t.clientY - drag.y;
      if (!drag.engaged) {
        if (drag.fromHeader) {
          if (dy <= 0) return;
        } else if (dy < -4 || Math.abs(dx) > Math.abs(dy) + 4 || body.scrollTop > 0) {
          drag = null; // an ordinary scroll
          return;
        } else if (dy < 10) {
          return;
        }
        drag.engaged = true;
        panel.style.transition = "none";
      }
      e.preventDefault();
      drag.dy = Math.max(0, dy);
      panel.style.transform = `translateY(${drag.dy}px)`;
    };
    const onEnd = () => {
      if (!drag) return;
      const { engaged, dy, t } = drag;
      drag = null;
      if (!engaged) return;
      const dismiss = dy > DISMISS_PX || (dy > FLICK_PX && Date.now() - t < FLICK_MS);
      panel.style.transition = "transform 0.2s ease-out";
      if (dismiss && !isDirtyRef.current()) {
        panel.style.transform = "translateY(100%)";
        setTimeout(() => onCloseRef.current(), 180);
      } else {
        panel.style.transform = "";
        if (dismiss) requestCloseRef.current(); // asks "Discard changes?"
      }
    };

    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: false });
    panel.addEventListener("touchend", onEnd);
    panel.addEventListener("touchcancel", onEnd);
    return () => {
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", onEnd);
      panel.removeEventListener("touchcancel", onEnd);
    };
  }, [open]);

  if (!open) return null;

  const keyboard = !!area?.keyboard;
  // Room for the home indicator, except while the keyboard covers it
  const bottomPad = keyboard ? "max-md:pb-3.5" : "max-md:pb-[max(14px,env(safe-area-inset-bottom))]";
  const sidePad = "max-md:pl-[max(20px,env(safe-area-inset-left))] max-md:pr-[max(20px,env(safe-area-inset-right))]";
  const footerLayout =
    variant === "form"
      ? "max-md:[&>.btn]:flex-1 max-md:[&>.btn]:min-h-12"
      : variant === "confirm"
        ? "max-md:flex-col-reverse max-md:items-stretch max-md:[&>.btn]:min-h-12"
        : "";

  return (
    <>
      {createPortal(
        <div
          className={`fixed inset-x-0 top-0 h-full z-[200] flex justify-center items-center max-md:items-end overscroll-none ${
            depth > 0 ? "bg-black/30" : "bg-black/60 backdrop-blur-[4px]"
          }`}
          style={area ? { top: area.top, height: area.height } : undefined}
          onClick={(e) => {
            if (e.target === e.currentTarget) requestClose();
          }}
        >
          <div
            ref={panelRef}
            role={variant === "confirm" ? "alertdialog" : "dialog"}
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            className={`sheet relative flex flex-col bg-bg-card border border-border rounded-2xl w-[520px] max-w-[90vw] max-h-[85%] shadow-[0_24px_48px_rgba(0,0,0,0.4)]
              max-md:w-full max-md:max-w-full max-md:max-h-[calc(100%-max(24px,env(safe-area-inset-top)))] max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:animate-[sheetUp_0.25s_ease-out] ${className}`}
          >
            {/* Header: title tight to the top, close pinned to the corner. Doubles as the drag handle on phones */}
            <div
              ref={headerRef}
              className="relative shrink-0 pl-6 pr-14 pt-5 pb-4 border-b border-border/60 max-md:pl-[max(20px,env(safe-area-inset-left))] max-md:pr-[calc(56px+env(safe-area-inset-right))] max-md:pt-2.5 max-md:touch-none"
            >
              <div className="hidden max-md:block w-9 h-1 rounded-full bg-white/20 mx-auto mb-3" />
              <h2 id={`${id}-title`} className="text-lg font-semibold flex items-center gap-2 min-w-0 leading-tight">
                <span className="truncate">{title}</span>
                {titleExtra}
              </h2>
              <IconButton
                label="Close"
                onClick={requestClose}
                className="absolute top-3 right-3 max-md:top-3.5 max-md:right-[calc(6px+env(safe-area-inset-right))] text-text-dim"
              />
            </div>

            {/* Content: the only part that scrolls */}
            <div
              ref={bodyRef}
              className={`flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pt-5 ${sidePad} ${
                footer ? "pb-5" : `pb-6 ${keyboard ? "max-md:pb-5" : "max-md:pb-[max(20px,env(safe-area-inset-bottom))]"}`
              }`}
            >
              {children}
              {aside && <div className="md:hidden mt-6 [&>.btn]:w-full [&>.btn]:min-h-12">{aside}</div>}
            </div>

            {/* Toasts render here on phones: above the action bar and the keyboard */}
            <div className="relative h-0 shrink-0 z-10">
              <div
                ref={slotRef}
                className={`absolute inset-x-4 flex flex-col pointer-events-none ${
                  footer ? "bottom-3" : "bottom-[max(12px,env(safe-area-inset-bottom))]"
                }`}
              />
            </div>

            {footer && (
              // A bar flush with the bottom edge, not floating above it
              <div
                className={`shrink-0 flex items-center justify-end gap-2.5 px-6 py-3.5 border-t border-border bg-bg-input/60 rounded-b-2xl max-md:rounded-none ${sidePad} ${bottomPad} ${footerLayout}`}
              >
                {aside && <div className="mr-auto max-md:hidden">{aside}</div>}
                {footer}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {asking && (
        <Modal
          open
          onClose={() => setAsking(false)}
          variant="confirm"
          title="Discard changes?"
          footer={
            <>
              <button className="btn" onClick={() => setAsking(false)}>Keep editing</button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  setAsking(false);
                  onCloseRef.current();
                }}
              >
                Discard
              </button>
            </>
          }
        >
          <p className="text-sm text-text-dim leading-relaxed">Your edits in “{title}” haven't been saved.</p>
        </Modal>
      )}
    </>
  );
}
