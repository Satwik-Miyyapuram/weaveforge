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
 * zotero/reader.
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
  }[] = [];

  for (const ann of annotations) {
    const strategy = chooseAnchorStrategy(ann.anchor, contentHash);
    const position = ann.anchor.zoteroPosition;
    if (!position) continue;

    const rectSets: { rects: number[][]; page: number }[] = [];
    if (position.pageIndex === pageIndex && position.rects?.length) {
      rectSets.push({ rects: position.rects, page: pageIndex });
    }
    const next = (position as { nextPageRects?: number[][] }).nextPageRects;
    if (position.pageIndex + 1 === pageIndex && next?.length) {
      rectSets.push({ rects: next, page: pageIndex });
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
          approximate: strategy.kind !== "rects",
        });
      }
    }
  }

  if (boxes.length === 0) return null;

  return (
    <div className="pdf-reader-ann-layer" aria-hidden>
      {boxes.map((box, i) => (
        <button
          key={`${box.id}-${i}`}
          type="button"
          className={`pdf-reader-ann${selectedId === box.id ? " is-selected" : ""}${
            box.approximate ? " is-approximate" : ""
          }`}
          style={{
            left: box.left,
            top: box.top,
            width: Math.max(box.width, 2),
            height: Math.max(box.height, 2),
            background: box.color,
          }}
          title={box.approximate ? "Position approximate" : undefined}
          onClick={() => onSelect(box.id)}
        />
      ))}
    </div>
  );
}
