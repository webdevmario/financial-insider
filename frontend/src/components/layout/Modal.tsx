import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  titleExtra?: React.ReactNode;
  /** Action buttons. Pinned under the scrolling content so they stay in reach on a phone. */
  footer?: React.ReactNode;
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

// Only the top-most modal answers Escape
const stack: string[] = [];

/**
 * The part of the screen not covered by the on-screen keyboard. iOS doesn't
 * shrink the layout viewport for the keyboard, so a sheet pinned to bottom: 0
 * would end up behind it; sizing the overlay to the visual viewport keeps the
 * sheet (and its focused input) above the keyboard.
 */
function useVisibleArea(active: boolean) {
  const [area, setArea] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const update = () => setArea({ top: vv.offsetTop, height: vv.height });
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

/**
 * Shared dialog: centred card on desktop, bottom sheet on phones.
 * The header and footer stay put; only the content between them scrolls.
 */
export default function Modal({ open, onClose, title, titleExtra, footer, className = "", children }: ModalProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; dy: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const area = useVisibleArea(open);

  useEffect(() => {
    if (!open) return;
    const returnFocus = document.activeElement as HTMLElement | null;
    lockScroll();
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === id) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(id), 1);
      unlockScroll();
      returnFocus?.focus?.({ preventScroll: true });
    };
  }, [open, id]);

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

  if (!open) return null;

  // Swipe the sheet's header down to dismiss (phones only)
  const onTouchStart = (e: React.TouchEvent) => {
    if (isPhone()) drag.current = { startY: e.touches[0].clientY, dy: 0 };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!drag.current || !panelRef.current) return;
    drag.current.dy = Math.max(0, e.touches[0].clientY - drag.current.startY);
    panelRef.current.style.transition = "none";
    panelRef.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onTouchEnd = () => {
    const panel = panelRef.current;
    if (!drag.current || !panel) return;
    const { dy } = drag.current;
    drag.current = null;
    panel.style.transition = "transform 0.2s ease-out";
    if (dy > 90) {
      panel.style.transform = "translateY(100%)";
      setTimeout(() => onCloseRef.current(), 180);
    } else {
      panel.style.transform = "";
    }
  };

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 h-full z-[200] bg-black/60 backdrop-blur-[4px] flex justify-center items-center max-md:items-end overscroll-none"
      style={area ? { top: area.top, height: area.height } : undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className={`flex flex-col bg-bg-card border border-border rounded-2xl w-[520px] max-w-[90vw] max-h-[85%] shadow-[0_24px_48px_rgba(0,0,0,0.4)]
          max-md:w-full max-md:max-w-full max-md:max-h-[calc(100%-max(24px,env(safe-area-inset-top)))] max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:animate-[sheetUp_0.25s_ease-out] ${className}`}
      >
        {/* Header: title tight to the top, close pinned to the corner. Doubles as the drag handle on phones */}
        <div
          className="relative shrink-0 pl-6 pr-14 pt-5 pb-4 border-b border-border/60 max-md:pl-5 max-md:pt-2.5 max-md:touch-none"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          <div className="hidden max-md:block w-9 h-1 rounded-full bg-white/20 mx-auto mb-3" />
          <h2 id={`${id}-title`} className="text-lg font-semibold flex items-center gap-2 min-w-0 leading-tight">
            <span className="truncate">{title}</span>
            {titleExtra}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 max-md:top-4 w-8 h-8 grid place-items-center rounded-lg text-text-dim hover:text-text hover:bg-white/[0.06] transition-colors"
          >
            <svg aria-hidden viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Content: the only part that scrolls */}
        <div
          ref={bodyRef}
          className={`flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pt-5 max-md:px-5 ${
            footer ? "pb-5" : "pb-6 max-md:pb-[max(20px,env(safe-area-inset-bottom))]"
          }`}
        >
          {children}
        </div>

        {footer && (
          // A bar flush with the bottom edge, not floating above it
          <div className="shrink-0 flex items-center justify-end gap-2.5 px-6 py-3.5 border-t border-border bg-bg-input/60 rounded-b-2xl max-md:px-5 max-md:rounded-none max-md:pb-[max(14px,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
