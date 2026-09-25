"use client";

import { useMemo, useState, type ReactNode } from "react";
import { pdfPointToScreen, pdfRectToScreenBox, type PageProjection } from "@weaveforge/core";
import { sanitizePdfUrl } from "../../application/sanitize-reader-url";
import { Modal } from "@/components/modal";
import { InkStrokes } from "@/features/ink";
import type { DraftShape } from "./types";
import type { MarginNote } from "../../application/margin-notes";

export function SafeExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const safe = sanitizePdfUrl(href);
  if (!safe) return null;
  return (
    <a className="btn-secondary" href={safe} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/**
 * Paints the mark currently under the pointer.
 *
 * Uses the same projection as the persisted overlay — `x * scale` and
 * `(pageHeight - y) * scale` — so the preview sits exactly where the saved
 * annotation lands, with no jump on release. The wet stroke goes through the
 * ink note's renderer, so it is the line the saved stroke will be rather than a
 * second approximation of it; the rectangle tools are the reader's own.
 */
export function DraftShapeOverlay({
  shape,
  color,
  projection,
}: {
  shape: DraftShape;
  color: string;
  projection: PageProjection;
}) {
  const points = useMemo(() => {
    if (shape.kind === "rect") return [];
    const out: number[] = [];
    for (let i = 0; i + 1 < shape.path.length; i += 2) {
      const screen = pdfPointToScreen(shape.path[i]!, shape.path[i + 1]!, projection);
      out.push(screen.x, screen.y);
    }
    return out;
  }, [shape, projection]);

  /**
   * The lasso loop, drawn exactly as the sheet draws it — same dashed accent
   * (`ink-lasso`, editor-workspace.css), so the gesture looks like the one the
   * hand already knows. A closed polygon: the last point joins the first, which
   * is the area the marks inside are judged against.
   */
  if (shape.kind === "lasso") {
    const loop: string[] = [];
    for (let i = 0; i + 1 < points.length; i += 2) {
      loop.push(`${points[i]},${points[i + 1]}`);
    }
    if (loop.length < 2) return null;
    return (
      <div className="pdf-reader-ann-layer" aria-hidden>
        <svg className="pdf-reader-ann-svg" width="100%" height="100%">
          <polygon className="ink-lasso" points={loop.join(" ")} />
        </svg>
      </div>
    );
  }

  if (shape.kind === "ink") {
    return (
      <div className="pdf-reader-ann-layer" aria-hidden>
        <InkStrokes
          className="pdf-reader-ann-svg"
          // The wet stroke wears the same look the saved one will, including
          // the reader's own highlighter over a page image.
          highlighterClassName="pdf-reader-ink--highlighter"
          strokes={[
            {
              points,
              // Same nib the saved stroke will have, so nothing changes
              // thickness on release.
              width: Math.max(shape.width * projection.scale, 0.5),
              colour: color,
              highlighter: shape.highlighter,
            },
          ]}
        />
      </div>
    );
  }

  const box = pdfRectToScreenBox(
    [
      Math.min(shape.x0, shape.x1),
      Math.min(shape.y0, shape.y1),
      Math.max(shape.x0, shape.x1),
      Math.max(shape.y0, shape.y1),
    ],
    projection,
  );

  return (
    <div className="pdf-reader-ann-layer" aria-hidden>
      <svg className="pdf-reader-ann-svg" width="100%" height="100%">
        <rect
          x={box.left}
          y={box.top}
          width={box.width}
          height={box.height}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      </svg>
    </div>
  );
}

/**
 * In-app composer for a text annotation's contents.
 *
 * Replaces `window.prompt`, which is an unstyled OS dialog that ignores the
 * app's theme and, on a phone, covers the page being annotated.
 */
export function TextBoxComposer({
  title,
  label,
  submitLabel,
  placeholder,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  submitLabel: string;
  placeholder: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const trimmed = text.trim();

  return (
    <Modal title={title} onClose={onCancel}>
      <div className="form-stack">
        <label className="field">
          {label}
          <textarea
            rows={4}
            value={text}
            autoFocus
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="screen-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={!trimmed}
            onClick={() => onSubmit(trimmed)}
          >
            {submitLabel}
          </button>
          <button type="button" className="btn-secondary btn-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The writing margin beside a page while the pen is out: a page-wide blank
 * strip to the right that ink can run onto, with the page's comments laid
 * down it level with the marks they belong to. The strip itself lets the
 * pointer through so a stroke starting on it reaches the page host; only the
 * cards catch a tap.
 */
export function PageMargin({
  notes,
  width,
  selectedId,
  onSelect,
}: {
  notes: readonly MarginNote[];
  width: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="pdf-reader-page-margin" style={{ width: `${width}px` }} aria-label="Writing margin">
      {notes.map((note) => (
        <button
          type="button"
          key={note.annotation.id}
          className={`pdf-reader-margin-note${selectedId === note.annotation.id ? " is-selected" : ""}`}
          style={{ top: `${note.top}px`, borderLeftColor: note.annotation.color }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onSelect(note.annotation.id)}
        >
          {note.annotation.text && (
            <span className="pdf-reader-margin-note-quote">{note.annotation.text}</span>
          )}
          <span className="pdf-reader-margin-note-comment">{note.annotation.comment}</span>
        </button>
      ))}
    </div>
  );
}
