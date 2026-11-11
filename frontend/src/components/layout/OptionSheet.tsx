import Modal from "./Modal";

export interface SheetOption<T extends string> {
  id: T;
  label: string;
  icon?: string;
  hint?: string;
}

interface OptionSheetProps<T extends string> {
  open: boolean;
  onClose: () => void;
  title: string;
  options: SheetOption<T>[];
  active?: string;
  onPick: (id: T) => void;
}

/** A short list of destinations in a bottom sheet: the "More" menu on phones */
export default function OptionSheet<T extends string>({ open, onClose, title, options, active, onPick }: OptionSheetProps<T>) {
  return (
    <Modal open={open} onClose={onClose} variant="list" title={title}>
      <div className="flex flex-col gap-1">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => {
              onPick(o.id);
              onClose();
            }}
            className={`flex items-center gap-3 text-left px-3 py-3 min-h-12 rounded-lg text-sm font-medium transition-colors ${
              o.id === active ? "bg-accent/10 text-accent" : "text-text hover:bg-white/[0.04]"
            }`}
          >
            {o.icon && <span className="text-xl leading-none w-7 text-center">{o.icon}</span>}
            <span className="min-w-0 flex-1">
              {o.label}
              {o.hint && <span className="block text-xs font-normal text-text-muted mt-0.5">{o.hint}</span>}
            </span>
            <span className="text-text-muted text-lg opacity-60">›</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
