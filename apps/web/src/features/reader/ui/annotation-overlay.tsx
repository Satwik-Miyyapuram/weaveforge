"use client";

import type { ReaderAnnotation } from "@thesis/core";
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
          {strokes.map((s, i) => (
            <polyline
              key={`${s.id}-ink-${i}`}
              points={s.points}
              fill="none"
              stroke={s.color}
              strokeWidth={selectedId === s.id ? 3 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              onClick={() => onSelect(s.id)}
              style={{ pointerEvents: "stroke", cursor: "pointer" }}
            />
          ))}
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
