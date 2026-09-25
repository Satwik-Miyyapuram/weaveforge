"use client";

import { useState } from "react";

import { FormError } from "./form-error";
import { Modal } from "./modal";

/**
 * A question the app draws, not the OS.
 *
 * The same reasoning as `ConfirmDialog`: `window.prompt` is an unstyled system
 * dialog that ignores the theme and renders over the app on a phone. It is here
 * rather than in `ConfirmDialog` because a confirm is a yes/no and this one has
 * an answer to type — the two want different focus behaviour, and the confirm's
 * "never autofocus the dangerous button" rule does not apply to a text box that
 * is the whole point of the dialog.
 *
 * `validate` returns the message to show, or `null` when the value is fine; the
 * caller still owns what the value means.
 */
export function PromptDialog({
  title,
  body,
  label,
  initialValue = "",
  confirmLabel = "Continue",
  inputType = "text",
  validate,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  /** The input's own label, which is also its placeholder-free description. */
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  inputType?: "text" | "number";
  validate?: (value: string) => string | null;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [problem, setProblem] = useState<string | null>(null);
  const id = `${title.replace(/\s+/g, "-").toLowerCase()}-value`;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const message = validate?.(value) ?? null;
    if (message) {
      setProblem(message);
      return;
    }
    onConfirm(value);
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form className="prompt-dialog" onSubmit={submit}>
        <p className="muted confirm-dialog-body">{body}</p>
        <label className="prompt-dialog-field" htmlFor={id}>
          <span>{label}</span>
          <input
            id={id}
            type={inputType}
            value={value}
            autoFocus
            onChange={(event) => {
              setValue(event.target.value);
              setProblem(null);
            }}
          />
        </label>
        <FormError>{problem}</FormError>
        <div className="confirm-dialog-actions">
          <button type="button" className="btn-secondary btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
