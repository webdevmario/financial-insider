import { useEffect } from "react";

interface ToastProps {
  message: string;
  isError?: boolean;
  onClose: () => void;
}

export default function Toast({ message, isError, onClose }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onClose, 2200);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className={`fixed bottom-6 right-6 max-md:bottom-20 max-md:right-4 max-md:left-4 z-[300]
        bg-bg-card border rounded-xl px-5 py-3.5 text-[13px] shadow-[0_8px_32px_rgba(0,0,0,0.3)]
        animate-[slideUp_0.3s_ease] ${isError ? "border-red" : "border-green"}`}
    >
      {message}
    </div>
  );
}
