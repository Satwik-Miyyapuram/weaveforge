"use client";

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

export function AnnotationOverlay({
  annotations,
  pageNumber,
  contentHash = "",
  scale,
  pageHeight,
  selectedId,
  onSelect,
}: AnnotationOverlayProps) {
  const { boxes, strokes } = projectPageAnnotationGeometry({
    annotations,
    pageNumber,
    scale,
    pageHeight,
    contentHash,
  });

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
            return (
              <g key={`${s.id}-ink-${i}`}>
                {bounds && (
                  <rect
                    className="pdf-reader-ann-marquee"
                    x={bounds.x - 4}
                    y={bounds.y - 4}
                    width={bounds.width + 8}
                    height={bounds.height + 8}
                  />
                )}
                <polyline
                  points={s.points}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={selected ? 3 : 2}
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
