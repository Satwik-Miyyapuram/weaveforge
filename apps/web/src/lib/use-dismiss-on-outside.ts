"use client";

import { useEffect, type RefObject } from "react";

/**
 * Closes a popover when the reader clicks away from it or presses Escape.
 *
 * Eight components had written this out, all slightly differently, which is how
 * two of them ended up without an Escape key and one kept a document-level
 * mousedown listener installed while it was closed.
 *
 * `within` may name more than one element. A menu portalled out of its trigger
 * is still "inside" as far as the reader is concerned, and treating it as
 * outside closes it before the click reaches the option they aimed at.
 */
export function useDismissOnOutside(
  open: boolean,
  onDismiss: () => void,
  within: RefObject<HTMLElement | null> | readonly RefObject<HTMLElement | null>[],
): void {
  useEffect(() => {
    if (!open) return;
    const refs = Array.isArray(within) ? within : [within as RefObject<HTMLElement | null>];

    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };

    // `mousedown` rather than `click`: a click that starts inside the panel and
    // ends outside it is a drag-select, not a dismissal.
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // `onDismiss` is a setter or a small closure at every call site; including
    // it would re-install both listeners on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
