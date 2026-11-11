/**
 * Packing a stroke for storage while it is written: points are only appended,
 * so the stroke committed on lift is the last one drawn. The packer lives in
 * the Rust core (wf-core `ink::stroke_packer`); these are its shapes.
 */


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

