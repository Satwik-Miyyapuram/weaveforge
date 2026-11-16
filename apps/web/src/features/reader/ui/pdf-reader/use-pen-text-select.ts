"use client";

import { useEffect, type RefObject } from "react";
import { readyCore } from "@/lib/rust-core";

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
 * Only a press on the text layer. A mouse on the words keeps the browser's own
 * selection (double-click for a word, shift-click to extend); a mouse press
 * just beside the words — left of a line, past its end, between lines — would
 * start no selection at all, so the reader starts it at the nearest text
 * (`snapToText` in the Rust core). A finger belongs to `use-reader-gestures`.
 */
export function usePenTextSelect(containerRef: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !enabled) return;
    let anchor: { node: Node; offset: number } | null = null;
    let pointerId: number | null = null;

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      const layer = target?.closest?.(".pdf-reader-textlayer");
      if (!layer) return;
      let at: { node: Node; offset: number } | null;
      if (event.pointerType === "pen") {
        at = caretAt(event.clientX, event.clientY) ?? snappedCaret(layer, event.clientX, event.clientY);
      } else if (event.pointerType === "mouse") {
        // A mouse press on the words, a double-click or a modified click keeps
        // the browser's own selection; only a press beside the words is helped.
        if (event.detail > 1 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
        if (target!.closest(TEXT_RUN)) return;
        at = snappedCaret(layer, event.clientX, event.clientY);
      } else return;
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
      let at = caretAt(event.clientX, event.clientY);
      if (!at || !(at.node.parentElement?.closest(TEXT_RUN) && root.contains(at.node))) {
        // Beside the words the selection reaches the nearest text on that line.
        const under = document.elementFromPoint(event.clientX, event.clientY)?.closest(".pdf-reader-textlayer");
        const layer = under ?? anchor.node.parentElement?.closest(".pdf-reader-textlayer");
        at = layer ? snappedCaret(layer, event.clientX, event.clientY) : null;
      }
      // Far from any text the selection holds where it last reached.
      if (!at) return;
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

/** A run of words in the text layer; marked-content groups and figures are not text. */
const TEXT_RUN = ".pdf-reader-textlayer span:not(.markedContent):not([role='img'])";

/** The caret in the text nearest a point beside the words, or null when none is near. */
function snappedCaret(layer: Element, x: number, y: number): { node: Node; offset: number } | null {
  const runs = Array.from(layer.querySelectorAll<HTMLElement>(TEXT_RUN)).filter((run) => run.firstChild?.nodeType === Node.TEXT_NODE);
  // Plain boxes: DOMRect getters do not cross into the Rust core.
  const boxes = runs.map((run) => {
    const { left, top, right, bottom } = run.getBoundingClientRect();
    return { left, top, right, bottom };
  });
  const point = readyCore().snapToText(boxes, x, y);
  if (!point) return null;
  const run = runs[point.index]!;
  const at = caretAt(point.x, point.y);
  if (at && run.contains(at.node)) return at;
  // Something drawn over the text hid it from the hit test: take the near end.
  const text = run.firstChild!;
  const box = run.getBoundingClientRect();
  return { node: text, offset: point.x < (box.left + box.right) / 2 ? 0 : (text.textContent ?? "").length };
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
