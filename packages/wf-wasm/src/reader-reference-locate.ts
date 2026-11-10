/**
 * Mention geometry (Rust `reader_reference_locate`), re-exported from index.ts. Keeps the signatures of the removed
 * application/reference-locate.ts.
 */
import { locateMention as rawLocateMention, unionRect as rawUnionRect } from "../pkg/wf_wasm.js";
import type { PageTextItem } from "./reader-types.js";

export type { MentionGeometry } from "./bindings.js";

/** `[x0, y0, x1, y1]` in PDF user space, origin bottom-left. */
export type PdfRect = [number, number, number, number];

/**
 * A page text item as the locator reads it: `str`, `hasEOL`, and the `transform`, `width` and `height`
 * that place the rects. Passing only `str` would yield no geometry.
 */
export type LocatePageTextItem = PageTextItem;

/** Rects covering `[start, end)` of the page text. Out-of-range or empty ranges yield no geometry. */
export function locateMention(
  items: readonly LocatePageTextItem[],
  start: number,
  end: number,
): { rects: PdfRect[]; bounds: PdfRect | null } {
  // Rust fills every side (the TS geometry had no nulls); the generated type reads `number | null`.
  return rawLocateMention(items, start, end) as { rects: PdfRect[]; bounds: PdfRect | null };
}

/** Smallest rect containing every input rect, or null when given none. */
export function unionRect(rects: readonly PdfRect[]): PdfRect | null {
  return rawUnionRect(rects) as PdfRect | null;
}
