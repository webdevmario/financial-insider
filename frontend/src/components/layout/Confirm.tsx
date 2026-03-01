import Modal from "./Modal";

interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function Confirm({ open, title, message, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="text-sm text-text-dim mb-6 leading-relaxed">{message}</p>
      <div className="flex justify-end gap-2.5 pt-4 border-t border-border">
        <button onClick={onCancel} className="btn">
          Cancel
        </button>
        <button onClick={onConfirm} className="btn btn-danger">
          Delete
        </button>
      </div>
    </Modal>
  );
}
