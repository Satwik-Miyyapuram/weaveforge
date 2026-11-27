/** Which ink marks on a page a point or a lasso loop touches. */

import { INK_DEFAULT_WIDTH, type ReaderAnnotation } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/**
 * Ink annotations on this page whose stroke passes within `radius` of a point.
 *
 * Reads the page's bucket rather than the whole document: the eraser runs this
 * on every pointer move, and scanning every annotation in a heavily marked-up
 * paper to find the handful on the page under the pen is work for nothing.
 */
export function inkAnnotationsAt(onPage: readonly ReaderAnnotation[], pageNumber: number, x: number, y: number, radius: number) {
  return onPage.filter((ann) => {
    if (ann.type !== "ink") return false;
    const position = ann.anchor.zoteroPosition;
    if (!position?.paths?.length || position.pageIndex !== pageNumber - 1) return false;
    const nib = typeof position.width === "number" ? position.width : INK_DEFAULT_WIDTH;
    return readyCore().inkPathsHitTest(position.paths, x, y, radius + nib / 2);
  });
}

/**
 * The ink on a page the loop has caught.
 *
 * Judged per annotation, on all of its strokes together
 * (`inkPathsInPolygon`): a mark is one thing the hand wrote, and a loop round
 * most of it picks up the whole of it.
 */
export function inkAnnotationsInLoop(onPage: readonly ReaderAnnotation[], pageNumber: number, polygon: readonly number[]): string[] {
  return onPage
    .filter((ann) => {
      if (ann.type !== "ink") return false;
      const position = ann.anchor.zoteroPosition;
      if (!position?.paths?.length || position.pageIndex !== pageNumber - 1) return false;
      return readyCore().inkPathsInPolygon(position.paths, polygon);
    })
    .map((ann) => ann.id);
}
