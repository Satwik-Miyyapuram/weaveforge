"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { ReaderAnnotationType } from "@weaveforge/core";
import { READER_ANNOTATION_COLORS } from "../application/reader-annotation-helpers";

/**
 * Where a selection sits in the scroller's content, in CSS pixels: the middle
 * of its box across, and its top and bottom. Content coordinates rather than
 * the window's, so a popover placed by them scrolls with the words.
 */
export interface SelectionAnchor {
  x: number;
  top: number;
  bottom: number;
  /** Too close to the top of the view to sit above the words: it sits under them. */
  below: boolean;
}

/** Room the popover needs above a selection before it goes under it instead. */
const ROOM_ABOVE = 56;
/** Gap between the words and the popover, and between it and the scroller's edge. */
const GAP = 8;

export function selectionAnchor(range: Range, scroller: HTMLElement): SelectionAnchor | null {
  const box = range.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;
  const view = scroller.getBoundingClientRect();
  const top = box.top - view.top + scroller.scrollTop;
  return {
    x: box.left + box.width / 2 - view.left + scroller.scrollLeft,
    top,
    bottom: top + box.height,
    below: box.top - view.top < ROOM_ABOVE,
  };
}

interface SelectionCreateBarProps {
  at: SelectionAnchor;
  busy?: boolean;
  /** Active colour from the toolbar picker. */
  color?: string;
  onCreate: (type: Extract<ReaderAnnotationType, "highlight" | "underline" | "note">, color: string) => void;
  onCancel: () => void;
}

/**
 * What to make of a selection, raised over the words once the selection ends —
 * the mouse button up or the pen lifted. The words are their own preview, so
 * the popover does not repeat them.
 */
export function SelectionCreateBar({
  at,
  busy,
  color = READER_ANNOTATION_COLORS[0],
  onCreate,
  onCancel,
}: SelectionCreateBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);
  // Centred on the words, then kept inside the scroller's width.
  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = el?.offsetParent as HTMLElement | null;
    if (!el || !scroller) return;
    const width = el.offsetWidth;
    const max = Math.max(GAP, scroller.scrollWidth - width - GAP);
    setLeft(Math.min(max, Math.max(GAP, at.x - width / 2)));
  }, [at.x]);
  const style: CSSProperties = {
    left: left ?? at.x,
    top: at.below ? at.bottom + GAP : at.top - GAP,
    visibility: left == null ? "hidden" : undefined,
  };

  return (
    <div
      ref={ref}
      className={`pdf-reader-create-bar${at.below ? " is-below" : ""}`}
      role="toolbar"
      aria-label="Create annotation"
      style={style}
      // A press here must not clear the selection it is about.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="pdf-reader-create-colors" role="group" aria-label="Colour">
        {READER_ANNOTATION_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={`pdf-reader-create-swatch${swatch === color ? " is-active" : ""}`}
            style={{ background: swatch }}
            aria-label={`Highlight ${swatch}`}
            aria-pressed={swatch === color}
            disabled={busy}
            onClick={() => onCreate("highlight", swatch)}
          />
        ))}
      </div>
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={busy}
        onClick={() => onCreate("underline", color)}
      >
        Underline
      </button>
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={busy}
        onClick={() => onCreate("note", color)}
      >
        Note
      </button>
      <button type="button" className="btn-ghost btn-cancel btn-sm" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
