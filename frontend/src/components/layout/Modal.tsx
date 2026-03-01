import { useEffect, useRef } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  titleExtra?: React.ReactNode;
  children: React.ReactNode;
}

export default function Modal({ open, onClose, title, titleExtra, children }: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Focus first input when modal opens
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const input = contentRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
      );
      input?.focus();
    }, 100);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-[4px] flex justify-center items-center max-md:items-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={contentRef}
        className="bg-bg-card border border-border rounded-2xl p-8 w-[520px] max-w-[90vw] max-h-[85vh] overflow-y-auto shadow-[0_24px_48px_rgba(0,0,0,0.4)]
          max-md:max-w-full max-md:w-full max-md:max-h-[85dvh] max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:p-5 max-md:pb-8 max-md:animate-[sheetUp_0.25s_ease-out]"
      >
        {/* Mobile drag handle */}
        <div className="hidden max-md:block w-9 h-1 rounded-full bg-white/20 mx-auto mb-4" />

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[22px] max-md:text-xl font-semibold flex items-center gap-2">
            {title}
            {titleExtra}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 px-2.5 border border-border rounded-lg text-text-dim hover:border-accent hover:text-text transition-all text-base"
          >
            ✕
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
