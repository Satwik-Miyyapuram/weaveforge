"use client";

import { memo, useMemo } from "react";
import type { ReaderAnnotation } from "@weaveforge/core";
import { INK_SELECTION_HALO_PX, InkStrokes } from "@/features/ink";
import { projectPageAnnotationGeometry } from "../application/project-annotation-geometry";

interface AnnotationOverlayProps {
  annotations: ReaderAnnotation[];
  pageNumber: number;
  /** Current PDF content hash for rect trust. */
  contentHash?: string;
  scale: number;
  rotation: number;
  pageHeight: number;
  pageWidth: number;
  selectedId: string | null;
  /** The ink marks a lasso has picked up, by annotation id. */
  inkSelectedIds?: readonly string[];
  /**
   * A highlight was tapped.
   *
   * Only the highlight boxes answer to this. Ink does not: it is picked up with
   * the lasso, by geometry, and never has to be a target on the page — see the
   * note on this component.
   */
  onSelect?: (id: string) => void;
}

/**
 * Paint page-local annotation geometry. All coordinate maths lives in
 * `projectPageAnnotationGeometry`; this component is markup only.
 *
 * There are two kinds of mark here and they are drawn by two different things,
 * deliberately. A **highlight** is a rectangle of text and stays a DOM box:
 * it sits under the page's own words, takes their colour, and is what a tap
 * lands on. **Ink** is drawn by the ink note's renderer (`InkStrokes`), so a
 * stroke written on a paper is the same path, cap, join and highlighter tint as
 * one written on a note — the reader owns no stroke renderer of its own.
 *
 * The ink is paint and nothing else: it takes no pointer. Marks are picked up
 * with the lasso, which works by geometry (`inkAnnotationsAt`) rather than by
 * hit-testing the DOM, so a stroke never has to be a target — and, being no
 * target, it never stands between the pen and the words underneath it.
 */
function AnnotationOverlayInner({
  annotations,
  pageNumber,
  contentHash = "",
  scale,
  rotation,
  pageHeight,
  pageWidth,
  selectedId,
  inkSelectedIds,
  onSelect,
}: AnnotationOverlayProps) {
  // Projection is the reader's per-frame cost: ~1.7 ms for a page holding 100
  // ink annotations, 6.5 ms at 400. Drawing a stroke re-renders this component
  // once per animation frame, and every *other* page's overlay along with it,
  // so without this the whole document is re-projected 60 times a second while
  // the pen is down. Memoised on the inputs the geometry actually depends on.
  const { boxes, strokes } = useMemo(
    () =>
      projectPageAnnotationGeometry({
        annotations,
        pageNumber,
        scale,
        pageHeight,
        pageWidth,
        rotation,
        contentHash,
      }),
    [annotations, pageNumber, scale, pageHeight, pageWidth, rotation, contentHash],
  );

  const ink = useMemo(
    () =>
      strokes.map((s) => ({
        id: s.id,
        points: s.points,
        width: s.width,
        colour: s.color,
        highlighter: s.highlighter,
      })),
    [strokes],
  );

  if (boxes.length === 0 && ink.length === 0) return null;

  return (
    <div className="pdf-reader-ann-layer" aria-hidden>
      <InkStrokes
        className="pdf-reader-ann-svg"
        // A highlighter over a PDF page is the reader's own look, not the
        // sheet's: see `InkStrokes.highlighterClassName`.
        highlighterClassName="pdf-reader-ink--highlighter"
        strokes={ink}
        // The list's single selection and the lasso's set are one selection as
        // far as the ink is concerned: both are marks that are picked up.
        selectedIds={
          selectedId ? [...(inkSelectedIds ?? []), selectedId] : inkSelectedIds
        }
        // A picked-up mark wears the note's halo, not a box round it — the box
        // belongs to the highlight rectangles below, which *are* rectangles.
        haloGrow={INK_SELECTION_HALO_PX}
      />
      {boxes.map((box, i) => (
        <button
          key={`${box.id}-${i}`}
          type="button"
          className={`pdf-reader-ann${selectedId === box.id ? " is-selected" : ""}${
            box.underline ? " is-underline" : ""
          }`}
          style={{
            left: box.left,
            top: box.top,
            width: Math.max(box.width, 2),
            height: Math.max(box.height, 2),
            background: box.underline ? "transparent" : box.color,
            borderBottom: box.underline ? `2px solid ${box.color}` : undefined,
          }}
          onClick={onSelect ? () => onSelect(box.id) : undefined}
        />
      ))}
    </div>
  );
}

/**
 * Every page in the document mounts one of these, so a re-render of the reader
 * fans out across the whole file. The props are the page's own geometry and a
 * bucketed annotation array whose identity only changes when that page's
 * annotations do — so a stroke on page 3 leaves pages 1, 2, 4… untouched
 * instead of re-projecting each of them.
 */
export const AnnotationOverlay = memo(AnnotationOverlayInner);
