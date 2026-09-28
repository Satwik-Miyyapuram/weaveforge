"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
const FIELD =
  '[autofocus],[data-autofocus],textarea:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled])';

/** Focus the first field in `root` so typing starts at once; buttons only when there is no field. */
export function focusFirstField(root: HTMLElement | null) {
  if (!root || root.contains(document.activeElement)) return;
  (root.querySelector<HTMLElement>(FIELD) ?? root.querySelector<HTMLElement>(FOCUSABLE) ?? root).focus();
}

/** A dialog's closing choices, Cancel first and the primary last: a right-hand row on desktop, equal buttons on phones. */
export function ModalActions({ children }: { children: ReactNode }) {
  return <div className="modal-actions">{children}</div>;
}

/**
 * Viewport dialog. Always portaled to `document.body` so card overflow /
 * transform / filter ancestors cannot clip or trap `position: fixed`.
 * `dialog` is centred on desktop and a bottom sheet on phones; `palette` has no
 * head, sits high on desktop and drops from the top on phones.
 */
export function Modal({
  title,
  onClose,
  dismissible = true,
  variant = "dialog",
  className,
  onKeyDown,
  children,
}: {
  title: string;
  onClose?: () => void;
  /** When false, hide close control and ignore ESC / backdrop click. */
  dismissible?: boolean;
  variant?: "dialog" | "palette";
  className?: string;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // A click's target is the nearest element holding both the press and the
  // release, so selecting the text in a field and letting go past the dialog's
  // edge "clicks" the backdrop. Only a press that began on the backdrop closes.
  const pressedBackdropRef = useRef(false);
  const titleId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    // Locking the scroll takes the scrollbar away, which widens every element
    // behind the modal. That is not only a visible jump: `CardColumns` watches
    // its own width and re-deals the cards when the column count changes, so a
    // modal opened from a card could widen the page, gain a column, remount the
    // card it lives in — and close itself. Hold the width still.
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPadding = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (gutter > 0) document.body.style.paddingRight = `${gutter}px`;
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPadding;
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !dismissible || !onClose) return;
    const close = onClose;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mounted, dismissible, onClose]);

  useEffect(() => {
    if (!mounted) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const focusables = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(FOCUSABLE),
          ).filter((el) => el.offsetParent !== null)
        : [];
    focusFirstField(node);
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    node?.addEventListener("keydown", onKey);
    return () => {
      node?.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`modal-backdrop modal-backdrop--${variant}`}
      role="presentation"
      onPointerDown={(e) => {
        pressedBackdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const pressed = pressedBackdropRef.current;
        pressedBackdropRef.current = false;
        if (pressed && e.target === e.currentTarget && dismissible && onClose) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal modal--${variant}${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={variant === "dialog" ? titleId : undefined}
        aria-label={variant === "palette" ? title : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {variant === "dialog" ? (
          <div className="modal-head">
            <h3 id={titleId}>{title}</h3>
            {dismissible && onClose ? (
              <button type="button" className="link-btn modal-close" aria-label="Close" onClick={onClose}>
                ✕
              </button>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}
