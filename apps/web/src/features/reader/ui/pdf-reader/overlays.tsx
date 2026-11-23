"use client";

import { useMemo, type ReactNode } from "react";
import {   type PageProjection } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import type { DraftShape } from "./types";
import type { MarginNote } from "../../application/parts-2";
import { RowButton } from "@/components/controls";
import { Button } from "@/components/button";

export function SafeExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const safe = readyCore().sanitizePdfUrl(href);
  if (!safe) return null;
  return (
    <Button href={safe} target="_blank" rel="noreferrer">
      {children}
    </Button>
  );
}

/**
 * Paints the region or lasso currently under the pointer.
 *
 * Uses the same projection as the persisted overlay — `x * scale` and
 * `(pageHeight - y) * scale` — so the preview sits exactly where the saved
 * annotation lands. The wet ink stroke is not here: it is the notes' pen
 * drawing on its own canvas (`PdfInkPen`).
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
      const screen = readyCore().pdfPointToScreen(shape.path[i]!, shape.path[i + 1]!, projection);
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

  const box = readyCore().pdfRectToScreenBox(
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
        <span key={note.annotation.id} className="pdf-reader-margin-note-slot" style={{ top: `${note.top}px` }}>
          <RowButton
            current={selectedId === note.annotation.id}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSelect(note.annotation.id)}
          >
            <span className="pdf-reader-margin-note" style={{ borderLeftColor: note.annotation.color }}>
              {note.annotation.text && (
                <span className="pdf-reader-margin-note-quote">{note.annotation.text}</span>
              )}
              <span className="pdf-reader-margin-note-comment">{note.annotation.comment}</span>
            </span>
          </RowButton>
        </span>
      ))}
    </div>
  );
}
