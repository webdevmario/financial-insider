import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTopSheetSlot } from "../../lib/sheets";
import { useIsPhone } from "../../hooks/useIsPhone";

interface ToastProps {
  message: string;
  isError?: boolean;
  onClose: () => void;
}

export default function Toast({ message, isError, onClose }: ToastProps) {
  const slot = useTopSheetSlot();
  const phone = useIsPhone();

  useEffect(() => {
    const t = setTimeout(onClose, 2200);
    return () => clearTimeout(t);
  }, [onClose]);

  const box = `bg-bg-card border rounded-xl px-5 py-3.5 text-[13px] shadow-[0_8px_32px_rgba(0,0,0,0.3)] ${
    isError ? "border-red" : "border-green"
  }`;

  // On a phone with a sheet open, show it inside the sheet just above its
  // action bar, where the keyboard can't cover it
  if (phone && slot) {
    return createPortal(
      <div role="status" className={`${box} animate-[pillIn_0.2s_ease]`}>
        {message}
      </div>,
      slot
    );
  }

  return (
    <div
      role="status"
      className={`fixed bottom-6 right-6 max-md:bottom-20 max-md:right-4 max-md:left-4 z-[300] animate-[slideUp_0.3s_ease] ${box}`}
    >
      {message}
    </div>
  );
}
