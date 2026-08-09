"use client";

import { memo, useMemo } from "react";
import type { ReaderAnnotation } from "@weaveforge/core";
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
  onSelect: (id: string) => void;
}

/**
 * Paint page-local annotation geometry. All coordinate maths lives in
 * `projectPageAnnotationGeometry`; this component is markup only.
 */
/**
 * Bounding box of an SVG `points` string ("x,y x,y …"), in the same CSS pixels
 * the overlay is drawn in. Returns null when nothing parses.
 */
function strokeBounds(
  points: string,
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pair of points.split(/\s+/)) {
    const [rawX, rawY] = pair.split(",");
    const x = Number(rawX);
    const y = Number(rawY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function AnnotationOverlayInner({
  annotations,
  pageNumber,
  contentHash = "",
  scale,
  rotation,
  pageHeight,
  pageWidth,
  selectedId,
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

  if (boxes.length === 0 && strokes.length === 0) return null;

  return (
    <div className="pdf-reader-ann-layer" aria-hidden>
      {strokes.length > 0 && (
        <svg className="pdf-reader-ann-svg" width="100%" height="100%">
          {strokes.map((s, i) => {
            const selected = selectedId === s.id;
            // A thicker line was the only cue that a stroke was selected, which
            // is far too subtle to answer "what will Delete remove?". Draw the
            // stroke's extent as a dashed box, matching the boxed annotations.
            const bounds = selected ? strokeBounds(s.points) : null;
            // The marquee must clear the nib, or a highlighter's own width
            // spills outside the box that claims to contain it.
            const pad = 4 + s.width / 2;
            return (
              <g key={`${s.id}-ink-${i}`}>
                {bounds && (
                  <rect
                    className="pdf-reader-ann-marquee"
                    x={bounds.x - pad}
                    y={bounds.y - pad}
                    width={bounds.width + pad * 2}
                    height={bounds.height + pad * 2}
                  />
                )}
                <polyline
                  className={s.highlighter ? "pdf-reader-ink pdf-reader-ink--highlighter" : "pdf-reader-ink"}
                  points={s.points}
                  fill="none"
                  stroke={s.color}
                  // The nib width is the annotation's own, so a pressed pen
                  // stroke reads as heavier than a light one and a highlighter
                  // covers a line of text. Selection adds a hair, not a jump.
                  strokeWidth={Math.max(s.width + (selected ? 1 : 0), 0.5)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  onClick={() => onSelect(s.id)}
                  style={{ pointerEvents: "stroke", cursor: "pointer" }}
                />
              </g>
            );
          })}
        </svg>
      )}
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
          onClick={() => onSelect(box.id)}
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
