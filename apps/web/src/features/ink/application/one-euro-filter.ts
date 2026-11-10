/**
 * The 1-Euro filter: jitter damping that phases out with speed (D13).
 *
 * Revision 2 of the plan banned position filtering outright, on the grounds that
 * any filter adds lag to the pen. That is true of a *fixed* low-pass and false of
 * this one, which is why the plan retracted it. Casiez, Roussel and Vogel's
 * filter raises its own cutoff frequency with the signal's speed:
 *
 * ```
 * fc = minCutoff + beta · ‖dx/dt‖
 * ```
 *
 * so at the speed of deliberate writing the cutoff is a couple of hertz — which
 * damps a digitiser's grid quantisation and the hand's tremor — and at the speed
 * of a fast stroke it is hundreds of hertz, where the filter is very nearly the
 * identity and the lag is negligible. The result is a filter that is invisible
 * where lag would be felt and useful where staircasing would be seen.
 *
 * **One filter, one state.** The delegated trail needs a diameter *now* and the
 * worker needs the width it bakes into geometry. Filtering in two places — or in
 * one place and not the other — makes the wet tail and the dry ink disagree, and
 * the seam looks like a rendering bug rather than a data-flow one. So the filter
 * is created once, on the main thread, and the worker is handed its output.
 */

import { readyCore } from "@/lib/rust-core";
import type {
  FilteredNibSample as WasmFilteredNibSample,
  NibFilter as WasmNibFilter,
  OneEuroFilter as WasmOneEuroFilter,
} from "@weaveforge/wasm";

/** Cutoffs and speed coefficient for one channel. */
export interface OneEuroOptions {
  /**
   * Cutoff at zero speed, in hertz. Lower is smoother and laggier when the pen
   * is still — which is exactly when lag cannot be felt.
   */
  minCutoff: number;
  /**
   * How fast the cutoff rises with speed, in **hertz per (0.1 mm/ms)**.
   *
   * Not the paper's `0.007`. Casiez et al. state β against their own input units
   * (pixels per millisecond, and cursor speeds of a couple of those), and a
   * stroke here is measured in tenths of a millimetre, where handwriting runs at
   * 0.05–5 units/ms. Carrying 0.007 across would put the cutoff at 1.02 Hz at
   * 5 units/ms — the filter would damp a fast stroke exactly as hard as a still
   * pen, which is the lag revision 2 was right to fear. β is therefore tuned to
   * the *unit the samples are in*: see {@link INK_POSITION_FILTER}.
   */
  beta: number;
  /** Cutoff for the internal derivative estimate, in hertz. */
  derivativeCutoff: number;
}

/**
 * Position: `fcMin = 1 Hz`, `β = 30 Hz per (0.1 mm/ms)`.
 *
 * The pair to hold onto is the *behaviour*, and it is what the tests assert:
 *
 * | Speed | Cutoff | Lag behind a moving stroke |
 * | --- | --- | --- |
 * | 0.05 units/ms — a slow deliberate line | 2.5 Hz | a fraction of a pixel |
 * | 0.5 units/ms — normal writing | 16 Hz | ~0.5 mm |
 * | 5 units/ms — a fast sweep | 151 Hz | ~0.5 mm |
 *
 * The taper therefore damps where staircasing is visible and phases out where lag
 * would be felt. A *fixed* 1 Hz low-pass lags a normal-speed stroke by about 4 mm,
 * which is why revision 2's blanket ban read as necessary and why it was wrong.
 * `fcMin` is the plan's literature value and the paper's shape is unchanged; only
 * β is expressed in this feature's units. §9 item 7 is where the pair was
 * re-tuned on the real device: the first cut was `β = 80`, which phased out at
 * writing speed (41 Hz) and let the digitiser's per-sample jitter through as a
 * wobble on every curve. At 30 the lag caps near half a millimetre at any
 * speed — hidden under the OS ink trail on Windows, and a fraction of a nib
 * anywhere else — and a curve comes out as the hand drew it.
 *
 * `derivativeCutoff = 3 Hz` rather than the paper's 1 Hz, because the cutoff that
 * phases the filter out is *derived from* the speed estimate: at 1 Hz that
 * estimate takes ~150 ms to respond, so a stroke that reaches writing speed
 * quickly spends its first fifteen samples filtered as though it were still.
 */
export const INK_POSITION_FILTER: OneEuroOptions = {
  minCutoff: 1,
  beta: 30,
  derivativeCutoff: 3,
};

/**
 * Pressure: a higher floor and a much smaller β.
 *
 * A pressure channel is noisier than a position and *should not* phase out with
 * speed the way a position does — a press is a press whether the pen is moving or
 * not. `fcMin = 5 Hz` puts a deliberate press at 63 % in one time constant (32 ms)
 * and 95 % in 96 ms, while attenuating 120 Hz sensor noise about fivefold.
 */
export const INK_PRESSURE_FILTER: OneEuroOptions = {
  minCutoff: 5,
  beta: 2,
  derivativeCutoff: 3,
};

/**
 * The smoothing factor for a cutoff and a timestep: `1/(1 + τ/dt)`.
 *
 * `cutoff` is in **hertz** and `dt` in **milliseconds**, because a pen reports
 * milliseconds and a cutoff is a frequency. The conversion is explicit in the
 * Rust port (`ink::one_euro`) rather than left to the caller: mixing the two is
 * a factor of a thousand, and the symptom is a filter that looks like it is
 * working while doing almost nothing — at 120 Hz with `fc = 1` the right answer
 * is α ≈ 0.05, and the unit slip gives 0.98.
 */
export function oneEuroAlpha(cutoff: number, dtMs: number): number {
  return readyCore().oneEuroAlpha(cutoff, dtMs);
}

/**
 * One scalar channel, filtered. The state lives in the Rust core
 * (`ink::one_euro::OneEuroFilter`). The wasm handle is created on first use, not
 * in the constructor, so this class can be built before `loadCore()` resolves.
 */
export class OneEuroFilter {
  private core: WasmOneEuroFilter | undefined;

  constructor(private readonly options: OneEuroOptions) {}

  private get handle(): WasmOneEuroFilter {
    if (!this.core) this.core = new (readyCore().OneEuroFilter)(this.options);
    return this.core;
  }

  /** The last filtered value, or `null` before the first sample. */
  get last(): number | null {
    return this.handle.last;
  }

  /** The last estimated speed, in value units per millisecond. */
  get speed(): number {
    return this.handle.speed;
  }

  /** Forget everything. Called at pen-down: a new stroke is a new signal. */
  reset(): void {
    this.handle.reset();
  }

  filter(value: number, time: number): number {
    return this.handle.filter(value, time);
  }
}

/** One raw pen sample: position in 0.1 mm, pressure 0..1, time in ms. */
export interface NibSample {
  x: number;
  y: number;
  pressure: number;
  t: number;
}

/** A filtered pen sample, with the velocity the taper reads. */
export type FilteredNibSample = WasmFilteredNibSample;

/**
 * Position and pressure filtered as one state (`ink::one_euro::NibFilter`).
 * Options default to the tuned position and pressure channels above.
 */
export class NibFilter {
  private core: WasmNibFilter | undefined;
  private readonly options: { position: OneEuroOptions; pressure: OneEuroOptions };

  /** The wasm handle is created on first use, so construction may precede `loadCore()`. */
  constructor(
    options: { position?: OneEuroOptions; pressure?: OneEuroOptions } = {},
  ) {
    this.options = {
      position: options.position ?? INK_POSITION_FILTER,
      pressure: options.pressure ?? INK_PRESSURE_FILTER,
    };
  }

  private get handle(): WasmNibFilter {
    if (!this.core) this.core = new (readyCore().NibFilter)(this.options);
    return this.core;
  }

  /**
   * The speed the filter saw, in 0.1 mm per ms, from the *raw* samples. Raw
   * rather than filtered: the velocity taper is a drawing property.
   */
  get speed(): number {
    return this.handle.speed;
  }

  /** Start a new stroke: no state carries over from the last one. */
  reset(): void {
    this.handle.reset();
  }

  /** Snapshot the filter now; the returned function restores that snapshot. */
  save(): () => void {
    return this.handle.save();
  }

  filter(sample: NibSample): FilteredNibSample {
    return this.handle.filter(sample);
  }
}