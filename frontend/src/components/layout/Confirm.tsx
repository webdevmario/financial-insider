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

export default function Confirm({ open, title, message, confirmLabel = "Delete", onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
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
