"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
/** Gap between the words and the popover. */
const GAP = 10;
/** Gap between the popover and the scroller's edge. */
const EDGE = 8;

export function selectionAnchor(range: Range, scroller: HTMLElement): SelectionAnchor | null {
  return boxAnchor(range.getBoundingClientRect(), scroller);
}

/** The anchor for any box on screen: a selection's, or a tapped mark's. */
export function boxAnchor(box: DOMRect, scroller: HTMLElement): SelectionAnchor | null {
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
] as const;
export const COMMENT_PATH = "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z";

// Drawn, not typed: icons keep the bar short, and the theme fonts render "×" as a speck.
export function Glyph({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

interface SelectionCreateBarProps {
  at: SelectionAnchor;
  busy?: boolean;
  /** Active colour from the palette. */
  color?: string;
  /** Comment makes a highlight carrying the typed comment. */
  onCreate: (type: Extract<ReaderAnnotationType, "highlight" | "underline">, color: string, comment?: string) => void;
  onCancel: () => void;
}

/**
 * What to make of a selection, raised over the words once the selection ends —
 * the mouse button up or the pen lifted. Colour comes from the palette.
 */
export function SelectionCreateBar({
  at,
  busy,
  color = READER_ANNOTATION_COLORS[0],
  onCreate,
  onCancel,
}: SelectionCreateBarProps) {
  const [commenting, setCommenting] = useState(false);
  if (commenting) {
    return (
      <AnchoredBar at={at} label="Comment" className="pdf-reader-mark-bar">
        <div className="pdf-reader-pop-row">
          <CommentField
            placeholder="Comment on this…"
            initial=""
            busy={busy}
            onSave={(comment) => onCreate("highlight", color, comment)}
            onCancel={onCancel}
          />
        </div>
      </AnchoredBar>
    );
  }
  return (
    <AnchoredBar at={at} label="Create annotation">
      {CREATE_ACTIONS.map(({ type, label, path }) => (
        <IconButton key={type} label={label} path={path} disabled={busy} onClick={() => onCreate(type, color)} />
      ))}
      <IconButton label="Comment" path={COMMENT_PATH} disabled={busy} onClick={() => setCommenting(true)} />
      <span className="pdf-reader-create-vr" aria-hidden="true" />
      <IconButton label="Close" path="M6 6l12 12M18 6L6 18" disabled={busy} onClick={onCancel} />
    </AnchoredBar>
  );
}

function IconButton({ label, path, disabled, onClick }: { label: string; path: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn-ghost pdf-reader-create-icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Glyph d={path} />
    </button>
  );
}

/** A one-line comment and its Save: Enter saves, Escape closes. */
export function CommentField({
  placeholder,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  placeholder: string;
  initial: string;
  busy?: boolean;
  onSave: (comment: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const save = () => onSave(text.trim());
  return (
    <>
      <input
        className="pdf-reader-pop-input"
        aria-label="Comment"
        placeholder={placeholder}
        value={text}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") save();
          if (e.key === "Escape") onCancel();
        }}
      />
      <button type="button" className="btn-primary btn-sm pdf-reader-pop-btn" disabled={busy} onClick={save}>
        Save
      </button>
    </>
  );
}

/**
 * A bar raised over a box in the scroller's content, so it scrolls with what
 * it is about: centred on it, then kept inside the part of the scroller on screen.
 */
export function AnchoredBar({
  at,
  label,
  className,
  children,
}: {
  at: SelectionAnchor;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const scroller = el.offsetParent as HTMLElement | null;
      if (!scroller) return;
      const width = el.offsetWidth;
      const min = scroller.scrollLeft + EDGE;
      const max = Math.max(min, scroller.scrollLeft + scroller.clientWidth - width - EDGE);
      setLeft(Math.min(max, Math.max(min, at.x - width / 2)));
    };
    place();
    // The bar changes width when it turns into a comment field.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [at.x]);
  const style: CSSProperties = {
    left: left ?? at.x,
    top: at.below ? at.bottom + GAP : at.top - GAP,
    visibility: left == null ? "hidden" : undefined,
  };

  return (
    <div
      ref={ref}
      className={`pdf-reader-create-bar${at.below ? " is-below" : ""}${className ? ` ${className}` : ""}`}
      role="toolbar"
      aria-label={label}
      style={style}
      // A press here must not clear or alter the selection it is about,
      // and must not bubble pointer events to the scroller.
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!isField(event.target)) event.preventDefault();
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (!isField(event.target)) event.preventDefault();
      }}
    >
      {children}
    </div>
  );
}

/** The comment field takes the press, so it can focus and place the caret. */
function isField(target: EventTarget): boolean {
  return (target as Element).tagName === "INPUT";
}
