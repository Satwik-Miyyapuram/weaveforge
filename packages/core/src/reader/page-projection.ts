/**
 * PDF user space ↔ rendered page pixels, at any rotation.
 *
 * pdf.js rotates a page by composing a rotation into the viewport transform, so
 * a rendered page at 90° has the unrotated page's height as its width. Anything
 * that paints on top of the canvas — annotation overlays — or reads a pointer
 * position off it has to apply the same mapping, or it lands in the wrong place.
 *
 * The reader used to sidestep this by disabling annotations and every create
 * tool whenever `rotation !== 0`, which is a real limitation for the documents
 * that most need rotating: scanned landscape pages, sideways figures, and
 * anything a phone camera produced. These two functions are the whole fix, and
 * they are pure so the mapping can be tested without a DOM or pdf.js.
 *
 * Both directions agree with pdf.js's own viewport transform for rotations
 * 0/90/180/270 with a bottom-left PDF origin and a top-left screen origin.
 */

export interface PageProjection {
  /** Unrotated page size in PDF user-space units. */
  pageWidth: number;
  pageHeight: number;
  scale: number;
  /** 0, 90, 180 or 270. Other values are normalised. */
  rotation: number;
}

export function normalisePageRotation(rotation: number): 0 | 90 | 180 | 270 {
  const r = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  return (r === 90 || r === 180 || r === 270 ? r : 0) as 0 | 90 | 180 | 270;
}

/** Rendered size of the page at this rotation and scale, in CSS pixels. */
export function projectedPageSize(p: PageProjection): { width: number; height: number } {
  const rotation = normalisePageRotation(p.rotation);
  const swapped = rotation === 90 || rotation === 270;
  return {
    width: (swapped ? p.pageHeight : p.pageWidth) * p.scale,
    height: (swapped ? p.pageWidth : p.pageHeight) * p.scale,
  };
}

/** PDF user-space point → CSS pixels within the rendered page box. */
export function pdfPointToScreen(
  x: number,
  y: number,
  p: PageProjection,
): { x: number; y: number } {
  const { pageWidth, pageHeight, scale } = p;
  switch (normalisePageRotation(p.rotation)) {
    case 90:
      return { x: y * scale, y: x * scale };
    case 180:
      return { x: (pageWidth - x) * scale, y: y * scale };
    case 270:
      return { x: (pageHeight - y) * scale, y: (pageWidth - x) * scale };
    default:
      return { x: x * scale, y: (pageHeight - y) * scale };
  }
}

/** CSS pixels within the rendered page box → PDF user-space point. */
export function screenPointToPdf(
  sx: number,
  sy: number,
  p: PageProjection,
): { x: number; y: number } {
  const { pageWidth, pageHeight, scale } = p;
  const x = sx / scale;
  const y = sy / scale;
  switch (normalisePageRotation(p.rotation)) {
    case 90:
      return { x: y, y: x };
    case 180:
      return { x: pageWidth - x, y };
    case 270:
      return { x: pageWidth - y, y: pageHeight - x };
    default:
      return { x, y: pageHeight - y };
  }
}

/**
 * A PDF-space rect `[x1,y1,x2,y2]` as a screen-space box. Corners are projected
 * and re-normalised, since rotation swaps which corner is top-left.
 */
export function pdfRectToScreenBox(
  rect: readonly [number, number, number, number],
  p: PageProjection,
): { left: number; top: number; width: number; height: number } {
  const a = pdfPointToScreen(rect[0], rect[1], p);
  const b = pdfPointToScreen(rect[2], rect[3], p);
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}
