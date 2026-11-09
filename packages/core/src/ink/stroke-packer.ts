/**
 * Packing a stroke for storage while it is written: points are only appended,
 * so the stroke committed on lift is the last one drawn. The packer lives in
 * the Rust core (wf-core `ink::stroke_packer`); these are its shapes.
 */

import type { PackedInkStroke } from "./ink-note.js";

export interface InkStrokePackerOptions {
  tolerance?: number;
  maxPoints?: number;
  pressureTolerance?: number;
}

/** A live packer for one stroke, as the Rust core builds it. */
export interface LiveInkStrokePacker {
  /** Add the pen's next sample, in 0.1 mm, with its 0–255 pressure if it has one. A non-finite one is skipped. */
  push(x: number, y: number, pressure?: number | null): void;
  /** The stroke so far, as flat x,y pairs: every kept point, then the pen's latest sample. */
  points(): Float64Array;
  /** One pressure byte per point of `points()`. */
  pressures(): Float64Array;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface StrokePackerFns {
  /**
   * Storage-ready form of one captured stroke, pressure included: the whole
   * stroke pushed through a live packer. Fewer than two finite samples packs
   * to nothing; pressure of the wrong length is ignored.
   */
  packInkStroke(
    points: readonly number[],
    pressures?: readonly number[],
    options?: InkStrokePackerOptions,
  ): PackedInkStroke;
  /** A live packer, fed one sample at a time while the pen is down. */
  createInkStrokePacker(options?: InkStrokePackerOptions): LiveInkStrokePacker;
}
