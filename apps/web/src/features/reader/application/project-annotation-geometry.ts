/**
 * Project stored annotation geometry onto one rendered page.
 *
 * Anchors are stored in PDF user space with a bottom-left origin (Zotero's
 * convention); the DOM uses a top-left origin and CSS pixels. Keeping the flip
 * and the scale here means the overlay component is pure markup and the maths
 * can be tested without a DOM or pdf.js.
 */

import { chooseAnchorStrategy, type ReaderAnnotation } from "@thesis/core";

export interface AnnotationBox {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
  underline: boolean;
}

export interface AnnotationStroke {
  id: string;
  color: string;
  /** SVG `points` attribute value, already in CSS pixels. */
  points: string;
}

export interface PageAnnotationGeometry {
  boxes: AnnotationBox[];
  strokes: AnnotationStroke[];
}

export interface ProjectGeometryInput {
  annotations: readonly ReaderAnnotation[];
  /** 1-based page currently being painted. */
  pageNumber: number;
  scale: number;
  /** Unrotated page height in PDF user-space units. */
  pageHeight: number;
  /** Hash of the PDF on screen; "" means unknown. */
  contentHash: string;
}

/**
 * Group annotations by the 1-based page they paint on, so each page's overlay
 * scans only its own. Rendering every page against the whole list is
 * O(pages x annotations) — 60 pages of a heavily annotated paper is tens of
 * thousands of comparisons on every zoom or scroll.
 *
 * A highlight that crosses a page break paints on two pages, so it appears in
 * both buckets. Annotations with no stored position appear in none.
 */
export function bucketAnnotationsByPage(
  annotations: readonly ReaderAnnotation[],
): Map<number, ReaderAnnotation[]> {
  const byPage = new Map<number, ReaderAnnotation[]>();
  const add = (pageNumber: number, ann: ReaderAnnotation) => {
    const list = byPage.get(pageNumber);
    if (list) list.push(ann);
    else byPage.set(pageNumber, [ann]);
  };

  for (const ann of annotations) {
    const position = ann.anchor.zoteroPosition;
    if (!position || !Number.isInteger(position.pageIndex) || position.pageIndex < 0) continue;
    add(position.pageIndex + 1, ann);
    if (position.nextPageRects?.length) add(position.pageIndex + 2, ann);
  }
  return byPage;
}

function isRect(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 4 &&
    value.slice(0, 4).every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

export function projectPageAnnotationGeometry(
  input: ProjectGeometryInput,
): PageAnnotationGeometry {
  const { annotations, pageNumber, scale, pageHeight, contentHash } = input;
  const pageIndex = pageNumber - 1;
  const boxes: AnnotationBox[] = [];
  const strokes: AnnotationStroke[] = [];

  for (const ann of annotations) {
    const position = ann.anchor.zoteroPosition;
    if (!position) continue;
    // Stored geometry — rects and ink paths alike — only means anything against
    // the file it was captured on. Painting it after the file changed puts the
    // highlight over the wrong words, which is worse than showing nothing.
    if (chooseAnchorStrategy(ann.anchor, contentHash).kind !== "rects") continue;

    if (position.pageIndex === pageIndex && position.paths?.length) {
      for (const path of position.paths) {
        if (!Array.isArray(path) || path.length < 4) continue;
        const points: string[] = [];
        for (let i = 0; i + 1 < path.length; i += 2) {
          const x = path[i];
          const y = path[i + 1];
          if (typeof x !== "number" || typeof y !== "number") continue;
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          points.push(`${x * scale},${(pageHeight - y) * scale}`);
        }
        if (points.length >= 2) {
          strokes.push({ id: ann.id, color: ann.color, points: points.join(" ") });
        }
      }
    }

    const rectSets: number[][][] = [];
    if (position.pageIndex === pageIndex && position.rects?.length) {
      rectSets.push(position.rects);
    }
    // A highlight that began on the previous page spills its tail onto this one.
    if (position.pageIndex + 1 === pageIndex && position.nextPageRects?.length) {
      rectSets.push(position.nextPageRects);
    }

    for (const rects of rectSets) {
      for (const rect of rects) {
        if (!isRect(rect)) continue;
        const [x1, y1, x2, y2] = rect as [number, number, number, number];
        const bottom = Math.min(y1, y2);
        const topPdf = Math.max(y1, y2);
        boxes.push({
          id: ann.id,
          left: Math.min(x1, x2) * scale,
          top: (pageHeight - topPdf) * scale,
          width: Math.abs(x2 - x1) * scale,
          height: (topPdf - bottom) * scale,
          color: ann.color,
          underline: ann.type === "underline",
        });
      }
    }
  }

  return { boxes, strokes };
}
