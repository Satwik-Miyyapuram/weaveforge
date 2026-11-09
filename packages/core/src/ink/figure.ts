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
   * `[left, top, right, bottom]`, each 0–99. Absent means the whole image.
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

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface FigureFns {
  /**
   * The geometry tokens in an image alt, or `null` when the box is not
   * complete (`x` without `w`), because half a box cannot be drawn. `c` is
   * the crop; unknown tokens are left alone.
   */
  parseFigureTokens(alt: string): Omit<FigureGeometry, "path"> | null;
  /** A `c=l,t,r,b` value as crop insets clamped to 0..99; undefined when it is not four numbers. */
  parseFigureCrop(raw: string): [number, number, number, number] | undefined;
  /** The box moved so at least half of it stays on the paper; the same object when it already fits. */
  keepFigureOnPage<T extends Box>(one: T, pageSize: { width: number; height: number }): T;
  /** How near a corner, in page units at `scale` CSS pixels per unit, a press still takes it. */
  figureCornerHit(scale: number): number;
  /** The geometry tokens as they are written in an alt, for a complete box. */
  formatFigureTokens(geometry: Omit<FigureGeometry, "path">): string;
  /** The figures a page's text layer places, in the order their lines appear. */
  inkPageFigures(text: string): FigureGeometry[];
  /** A page's text with its figure block set: after the background line, before the page's own text. */
  withInkPageFigures(text: string, figures: readonly FigureGeometry[]): string;
  /** The alt of the first image ref at `path` in `body` when it is a placed figure, else `null`. */
  figureAltFor(body: string, path: string): string | null;
  /** The figures with the one at `index` moved; "front" is the end of the array. */
  reorderFigures<T>(figures: readonly T[], index: number, step: FigureOrderStep): T[];
  /**
   * A box resized by dragging `handle` by (`dx`, `dy`). The opposite side
   * holds still; a corner keeps the aspect unless `free`; no side gets
   * shorter than `min` (30).
   */
  resizeFigureBox(
    box: Box,
    handle: FigureHandle,
    dx: number,
    dy: number,
    options?: { free?: boolean; min?: number },
  ): Box;
  /** The rectangle the whole image would occupy with the crop lifted. */
  uncroppedFigureBox(figure: Omit<FigureGeometry, "path">): Box;
  /** Where the whole picture sits inside the figure's frame, in percent of the frame. */
  figureImageFrame(figure: Omit<FigureGeometry, "path">): {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  /** A figure re-cropped to `kept` inside the uncropped image `full`; keeping everything clears the crop. */
  cropFigureTo(full: Box, kept: Box): Pick<FigureGeometry, "x" | "y" | "w" | "h" | "crop">;
}
