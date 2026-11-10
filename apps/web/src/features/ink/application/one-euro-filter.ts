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
   * the *unit the samples are in*: see `position_options` in wf-core `ink::one_euro`.
   */
  beta: number;
  /** Cutoff for the internal derivative estimate, in hertz. */
  derivativeCutoff: number;
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
  private readonly options: { position?: OneEuroOptions; pressure?: OneEuroOptions };

  /**
   * The wasm handle is created on first use, so construction may precede `loadCore()`.
   * Defaults are read on first use too, from the Rust core, never copied here.
   */
  constructor(
    options: { position?: OneEuroOptions; pressure?: OneEuroOptions } = {},
  ) {
    this.options = options;
  }

  private get handle(): WasmNibFilter {
    if (!this.core) {
      const core = readyCore();
      this.core = new core.NibFilter({
        position: this.options.position ?? core.inkPositionOptions(),
        pressure: this.options.pressure ?? core.inkPressureOptions(),
      });
    }
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