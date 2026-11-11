/**
 * Figures: images placed on a page, in the text that already carries the page.
 *
 * A page of an ink note is markdown whose body is the recognised text layer;
 * a figure is one more image ref in that body — `![figure x=… y=… w=… h=…](vault:…)`
 * — so it lives where the note's own image bookkeeping already looks, moves
 * with the page under the CRDT, and survives as text in git. The same tokens
 * after an image's own alt text (`![photo right c=0,0,10,10|60%]`) place a
 * markdown note's image, because the two should not grow two syntaxes.
 *
 * The tokens are page units — tenths of a millimetre, the units every other
 * ink coordinate is in — except `c`, which is crop insets as percentages of
 * the image's own box (left, top, right, bottom) the way every crop tool
 * numbers them. A crop is geometry, not destruction: the bytes are untouched
 * and the crop is undone by clearing the token.
 *
 * The parsing and box maths live in the Rust core (`ink::figure`); this file
 * keeps the types and the signatures callers reach through `typedCore()`.
 */

/** The alt text that marks an image ref as a placed figure rather than prose. */
export const FIGURE_ALT = "figure";

/** An image placement: where on the page, how big, and how much of it shows. */
export interface FigureGeometry {
  /** The attachment this figure shows, without the `vault:` scheme. */
  path: string;
  /** The box's top-left corner from the page's top-left, in page units. */
  x: number;
  y: number;
  /** The box's size, in page units. */
  w: number;
  h: number;
  /**
   * How much of the image is cropped off, as percentages of its own box:
   * `[left, top, right, bottom]`, each 0–99. Absent or null means the whole image.
   */
  crop?: [number, number, number, number];
}

/** A box in page units. */
type Box = { x: number; y: number; w: number; h: number };

/** Where a figure moves in the page's stacking order. */
export type FigureOrderStep = "front" | "forward" | "backward" | "back";

/** A handle on a figure's box: a corner or an edge. */
export type FigureHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** The handles a box shows, in reading order. */
export const FIGURE_HANDLES: readonly FigureHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

