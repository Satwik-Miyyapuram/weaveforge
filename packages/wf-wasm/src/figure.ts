/**
 * Placed figures on an ink page (Rust `ink::figure`), re-exported from index.ts:
 * the `x= y= w= h= c=` tokens in an image alt, the figure block of a page's
 * text, and the box maths for moving, resizing and cropping a figure. Callers
 * get the narrow number types through `FigureFns` in the core contract.
 */
import {
  cropFigureTo as rawCropFigureTo,
  inkPageFigures as rawInkPageFigures,
  keepFigureOnPage as rawKeepFigureOnPage,
  parseFigureCrop as rawParseFigureCrop,
  parseFigureTokens as rawParseFigureTokens,
  reorderFigureIndices as rawReorderFigureIndices,
  resizeFigureBox as rawResizeFigureBox,
  withInkPageFigures as rawWithInkPageFigures,
} from "../pkg/wf_wasm.js";
import type {
  FigureBox,
  FigureHandle,
  FigureOrderStep,
  FigurePlacement,
  FigureRect,
} from "./bindings.js";

export {
  figureAltFor,
  figureCornerHit,
  figureImageFrame,
  formatFigureTokens,
  uncroppedFigureBox,
} from "../pkg/wf_wasm.js";

/** Drops a `crop` the Rust side left out, so the object compares like the old one. */
function withCrop<T extends { crop?: unknown }>(one: T): T {
  if (one.crop == null) delete one.crop;
  return one;
}

/** Just the box of `one`, so extra fields never reach serde. */
function rectOf(one: FigureRect): FigureRect {
  return { x: one.x, y: one.y, w: one.w, h: one.h };
}

/** The geometry tokens in an image alt, or `null` when the box is not complete. */
export function parseFigureTokens(alt: string): FigureBox | null {
  const one = rawParseFigureTokens(alt) as FigureBox | null;
  return one ? withCrop(one) : null;
}

/** A `c=l,t,r,b` value as crop insets clamped to 0..99; undefined when it is not four numbers. */
export function parseFigureCrop(raw: string): FigureBox["crop"] | undefined {
  return (rawParseFigureCrop(raw) as FigureBox["crop"]) ?? undefined;
}

/** The box moved so at least half of it stays on the page; the same object when it already fits. */
export function keepFigureOnPage<T extends FigureRect>(
  one: T,
  pageSize: { width: number; height: number },
): T {
  const [x, y] = rawKeepFigureOnPage(rectOf(one), pageSize.width, pageSize.height);
  return x === one.x && y === one.y ? one : { ...one, x, y };
}

/** The figures a page's text places, in line order. */
export function inkPageFigures(text: string): FigurePlacement[] {
  return (rawInkPageFigures(text) as FigurePlacement[]).map(withCrop);
}

/** A page's text with its figure block set: after the background line, before the text. */
export function withInkPageFigures(text: string, figures: readonly FigurePlacement[]): string {
  return rawWithInkPageFigures(
    text,
    figures.map(({ path, x, y, w, h, crop }) => ({ path, x, y, w, h, ...(crop ? { crop } : {}) })),
  );
}

/** The new order of `len` figures as old indices, with the one at `index` moved by `step`. */
export function reorderFigureIndices(len: number, index: number, step: FigureOrderStep): number[] {
  return Array.from(rawReorderFigureIndices(len, index, step));
}

/** The figures with the one at `index` moved; "front" is the end of the array. */
export function reorderFigures<T>(figures: readonly T[], index: number, step: FigureOrderStep): T[] {
  return reorderFigureIndices(figures.length, index, step).map((from) => figures[from]!);
}

/** A box resized by dragging `handle`; a corner keeps the aspect unless `free`; no side under `min` (30). */
export function resizeFigureBox(
  box: FigureRect,
  handle: FigureHandle,
  dx: number,
  dy: number,
  options: { free?: boolean; min?: number } = {},
): FigureRect {
  return rawResizeFigureBox(
    rectOf(box),
    handle,
    dx,
    dy,
    options.free ?? false,
    options.min ?? 30,
  ) as FigureRect;
}

/** A figure re-cropped to `kept` inside the uncropped image `full`; keeping everything clears the crop. */
export function cropFigureTo(full: FigureRect, kept: FigureRect): FigureBox {
  return withCrop(rawCropFigureTo(rectOf(full), rectOf(kept)) as FigureBox);
}
