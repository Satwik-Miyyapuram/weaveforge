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

const CREATE_ACTIONS = [
  { type: "highlight", label: "Highlight", path: "m9 11-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" },
  { type: "underline", label: "Underline", path: "M6 4v6a6 6 0 0 0 12 0V4M4 20h16" },
  { type: "note", label: "Comment", path: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" },
] as const;

// Drawn, not typed: icons keep the bar short, and the theme fonts render "×" as a speck.
function Glyph({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
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
  // Centred on the words, then kept inside the part of the scroller on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = el?.offsetParent as HTMLElement | null;
    if (!el || !scroller) return;
    const width = el.offsetWidth;
    const min = scroller.scrollLeft + GAP;
    const max = Math.max(min, scroller.scrollLeft + scroller.clientWidth - width - GAP);
    setLeft(Math.min(max, Math.max(min, at.x - width / 2)));
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
      // A press here must not clear or alter the selection it is about,
      // and must not bubble pointer events to the scroller.
      onPointerDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      {CREATE_ACTIONS.map(({ type, label, path }) => (
        <button
          key={type}
          type="button"
          className="btn-secondary btn-sm pdf-reader-create-icon"
          aria-label={label}
          title={label}
          disabled={busy}
          onClick={() => onCreate(type, color)}
        >
          <Glyph d={path} />
        </button>
      ))}
      <button
        type="button"
        className="btn-ghost btn-sm pdf-reader-create-close"
        aria-label="Close"
        title="Close"
        disabled={busy}
        onClick={onCancel}
      >
        <Glyph d="M6 6l12 12M18 6L6 18" />
      </button>
    </div>
  );
}
