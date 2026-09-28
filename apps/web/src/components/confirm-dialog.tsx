"use client";


import { Modal, ModalActions } from "./modal";

/**
 * A confirmation the app draws, not the OS.
 *
 * `window.confirm` is an unstyled system dialog: it ignores the theme, and in
 * the Android TWA it renders over the app as a platform alert. This codebase
 * already made and documented that decision once — `features/reader/ui/
 * pdf-reader/overlays.tsx` replaced `window.prompt` for exactly this reason —
 * and three call sites had not been migrated.
 *
 * Deliberately *not* used inside `app/route-error.tsx` or
 * `app/global-error.tsx`: an error boundary may be rendering because the
 * component tree that draws this modal is what failed, so those two keep the
 * platform dialog with a comment saying why.
 *
 * The action that does the damage is the one that needs a deliberate press, so
 * it never autofocuses — the modal's focus trap lands on Cancel first.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Paint the confirm button as destructive (`--danger`). */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={busy ? undefined : onClose} dismissible={!busy}>
      <p className="muted confirm-dialog-body">{body}</p>
      <ModalActions>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy} autoFocus>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? "btn-primary btn-danger" : "btn-primary"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </ModalActions>
    </Modal>
  );
}
