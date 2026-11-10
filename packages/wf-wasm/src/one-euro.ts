/**
 * The 1-Euro pen filter (Rust `ink::one_euro`): the smoothing factor and the
 * stateful filter handles the pen path holds across samples.
 */
import {
  NibFilter as RawNibFilter,
  OneEuroFilter as RawOneEuroFilter,
} from "../pkg/wf_wasm.js";

export {
  inkPositionOptions,
  inkPressureOptions,
  oneEuroAlpha,
} from "../pkg/wf_wasm.js";
// Narrowed by hand: Specta exports every f64 as `number | null`, but the filter
// only ever sees and returns finite numbers.

/** One channel's tuning: cutoffs in hertz, beta unitless. */
export interface OneEuroOptions {
  minCutoff: number;
  beta: number;
  derivativeCutoff: number;
}

/** One raw pen sample: position in 0.1 mm, pressure 0..1, time in ms. */
export interface NibSample {
  x: number;
  y: number;
  pressure: number;
  t: number;
}

/** A filtered pen sample, with the velocity the taper reads. */
export interface FilteredNibSample {
  x: number;
  y: number;
  pressure: number;
  velocity: number;
  t: number;
}

/** One scalar channel (Rust `OneEuroFilter`), held across calls. */
export class OneEuroFilter {
  private readonly raw: RawOneEuroFilter;

  constructor(options: OneEuroOptions) {
    this.raw = new RawOneEuroFilter(options);
  }

  /** The last filtered value, or `null` before the first sample. */
  get last(): number | null {
    return this.raw.last ?? null;
  }

  /** The last estimated speed, in value units per millisecond. */
  get speed(): number {
    return this.raw.speed;
  }

  /** Forget everything. Called at pen-down: a new stroke is a new signal. */
  reset(): void {
    this.raw.reset();
  }

  filter(value: number, time: number): number {
    return this.raw.filter(value, time);
  }
}

/** The pen-level filter (Rust `NibFilter`): position and pressure as one state. */
export class NibFilter {
  private readonly raw: RawNibFilter;

  constructor(options: { position: OneEuroOptions; pressure: OneEuroOptions }) {
    this.raw = new RawNibFilter(options.position, options.pressure);
  }

  /**
   * The speed the filter saw, in 0.1 mm per ms, from the *raw* samples. Raw
   * rather than filtered: the velocity taper is a drawing property.
   */
  get speed(): number {
    return this.raw.speed;
  }

  /** Start a new stroke: no state carries over from the last one. */
  reset(): void {
    this.raw.reset();
  }

  /** Snapshot the filter now; the returned function restores that snapshot. */
  save(): () => void {
    const snapshot = this.raw.save();
    return () => this.raw.restore(snapshot);
  }

  filter(sample: NibSample): FilteredNibSample {
    // Rust returns exactly [x, y, pressure, velocity, t].
    const [x, y, pressure, velocity, t] = this.raw.filter(
      sample.x,
      sample.y,
      sample.pressure,
      sample.t,
    ) as unknown as [number, number, number, number, number];
    return { x, y, pressure, velocity, t };
  }
}
