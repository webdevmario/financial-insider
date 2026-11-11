interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Spoken name; icon buttons have no visible text */
  label: string;
  /** Red on hover, for remove/delete */
  danger?: boolean;
}

/**
 * A small icon (✕, close) with a full 44px touch area on phones. The visible
 * box stays compact; the extra room is padding, so rows don't grow on desktop.
 */
export default function IconButton({ label, danger, className = "", children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`shrink-0 grid place-items-center rounded-lg text-text-muted transition-colors disabled:opacity-40
        w-8 h-8 max-md:w-11 max-md:h-11 ${danger ? "hover:text-red" : "hover:text-text hover:bg-white/[0.06]"} ${className}`}
      {...rest}
    >
      {children ?? (
        <svg aria-hidden viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      )}
    </button>
  );
}
