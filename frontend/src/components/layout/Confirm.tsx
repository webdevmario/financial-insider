import Modal from "./Modal";

interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  /** Label of the destructive button (default "Delete") */
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A yes/no question. Opens on top of whatever asked it (the form stays put
 * underneath). Stacked full-width buttons on phones, destructive on top.
 */
export default function Confirm({ open, title, message, confirmLabel = "Delete", onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      variant="confirm"
      title={title}
      footer={
        <>
          <button onClick={onCancel} className="btn">
            Cancel
          </button>
          <button onClick={onConfirm} className="btn btn-danger">
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-text-dim leading-relaxed">{message}</p>
    </Modal>
  );
}
