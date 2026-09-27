"use client";

import { useEffect, type RefObject } from "react";

/**
 * A pen drags a text selection across the page, the way a mouse does.
 *
 * Chromium does not give a pen the mouse's drag-to-select: the scroller pins
 * `touch-action: none` so that pinch and pan are the reader's own gestures, and
 * on Windows a pen under `touch-action: none` presses and lifts without ever
 * extending a selection. So with the pointer tool armed the reader draws the
 * selection itself from the caret under the nib, and the lift is the same
 * `pointerup` the mouse ends on, which is what raises the create popover.
 *
 * Only a pen, and only a press on the text layer: a mouse keeps the browser's
 * own selection (double-click for a word, shift-click to extend), and a finger
 * belongs to `use-reader-gestures`.
 */
export function usePenTextSelect(containerRef: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !enabled) return;
    let anchor: { node: Node; offset: number } | null = null;
    let pointerId: number | null = null;

    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "pen" || event.button !== 0) return;
      const target = event.target as Element | null;
      if (!target?.closest(".pdf-reader-textlayer")) return;
      const at = caretAt(event.clientX, event.clientY);
      if (!at) return;
      // Keeps the press from starting a native drag or focus change that would
      // throw the new selection away.
      event.preventDefault();
      anchor = at;
      pointerId = event.pointerId;
      try {
        root.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic or already released: the moves still reach the page.
      }
      window.getSelection()?.collapse(at.node, at.offset);
    };

    const onMove = (event: PointerEvent) => {
      if (!anchor || event.pointerId !== pointerId) return;
      const at = caretAt(event.clientX, event.clientY);
      // Outside any text the selection holds where it last reached.
      if (!at || !root.contains(at.node)) return;
      event.preventDefault();
      window.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, at.node, at.offset);
    };

    const onEnd = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      anchor = null;
      pointerId = null;
      try {
        root.releasePointerCapture(event.pointerId);
      } catch {
        // Nothing to release.
      }
    };

    // Capture phase, so the page row's own handler sees a press that is
    // already the selection's.
    root.addEventListener("pointerdown", onDown, true);
    root.addEventListener("pointermove", onMove, true);
    // The end only lets capture go; the selection stays for the scroller's
    // `onPointerUp` to read.
    root.addEventListener("pointerup", onEnd);
    root.addEventListener("pointercancel", onEnd);
    return () => {
      root.removeEventListener("pointerdown", onDown, true);
      root.removeEventListener("pointermove", onMove, true);
      root.removeEventListener("pointerup", onEnd);
      root.removeEventListener("pointercancel", onEnd);
    };
  }, [containerRef, enabled]);
}

/** The text position under a point: the standard call, or Chromium's older one. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof doc.caretPositionFromPoint === "function") {
    const position = doc.caretPositionFromPoint(x, y);
    if (position?.offsetNode.nodeType === Node.TEXT_NODE) return { node: position.offsetNode, offset: position.offset };
  }
  const range = document.caretRangeFromPoint?.(x, y);
  if (range?.startContainer.nodeType === Node.TEXT_NODE) {
    return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}
