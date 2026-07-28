"use client";

import type { ReaderAnnotation } from "@thesis/core";
import { chooseAnchorStrategy } from "@thesis/core";

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
 * Render page-local annotation geometry. Rects are PDF user-space (origin
 * bottom-left); we flip Y using pageHeight then scale — same convention as
 * zotero/reader. Ink uses `paths`.
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
  const pageIndex = pageNumber - 1;
  const boxes: {
    id: string;
    left: number;
    top: number;
    width: number;
    height: number;
    color: string;
    approximate: boolean;
    underline: boolean;
  }[] = [];
  const strokes: {
    id: string;
    color: string;
    points: string;
    selected: boolean;
  }[] = [];

  for (const ann of annotations) {
    const strategy = chooseAnchorStrategy(ann.anchor, contentHash);
    const position = ann.anchor.zoteroPosition;
    if (!position) continue;

    if (position.pageIndex === pageIndex && position.paths?.length) {
      for (const path of position.paths) {
        if (!Array.isArray(path) || path.length < 4) continue;
        const pts: string[] = [];
        for (let i = 0; i + 1 < path.length; i += 2) {
          const x = path[i]! * scale;
          const y = (pageHeight - path[i + 1]!) * scale;
          pts.push(`${x},${y}`);
        }
        strokes.push({
          id: ann.id,
          color: ann.color,
          points: pts.join(" "),
          selected: selectedId === ann.id,
        });
      }
    }

    // Only paint stored rects when the hash strategy trusts them — never on mismatch.
    if (strategy.kind !== "rects") continue;

    const rectSets: { rects: number[][]; page: number }[] = [];
    if (position.pageIndex === pageIndex && position.rects?.length) {
      rectSets.push({ rects: position.rects, page: pageIndex });
    }
    if (position.pageIndex + 1 === pageIndex && position.nextPageRects?.length) {
      rectSets.push({ rects: position.nextPageRects, page: pageIndex });
    }

    for (const set of rectSets) {
      for (const rect of set.rects) {
        if (!Array.isArray(rect) || rect.length < 4) continue;
        const [x1, y1, x2, y2] = rect as [number, number, number, number];
        const left = Math.min(x1, x2) * scale;
        const width = Math.abs(x2 - x1) * scale;
        const bottom = Math.min(y1, y2);
        const topPdf = Math.max(y1, y2);
        const height = Math.abs(topPdf - bottom) * scale;
        const top = (pageHeight - topPdf) * scale;
        boxes.push({
          id: ann.id,
          left,
          top,
          width,
          height,
          color: ann.color,
          approximate: false,
          underline: ann.type === "underline",
        });
      }
    }
  }

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
              strokeWidth={s.selected ? 3 : 2}
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
            box.approximate ? " is-approximate" : ""
          }${box.underline ? " is-underline" : ""}`}
          style={{
            left: box.left,
            top: box.top,
            width: Math.max(box.width, 2),
            height: Math.max(box.height, 2),
            background: box.underline ? "transparent" : box.color,
            borderBottom: box.underline ? `2px solid ${box.color}` : undefined,
          }}
          title={box.approximate ? "Position approximate" : undefined}
          onClick={() => onSelect(box.id)}
        />
      ))}
    </div>
  );
}
