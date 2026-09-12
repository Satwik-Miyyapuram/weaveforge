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

/** Milliseconds in a second: the filter's cutoffs are per second, its input per ms. */
const MS_PER_SECOND = 1_000;

/**
 * The smoothing factor for a cutoff and a timestep: `1/(1 + τ/dt)`.
 *
 * `cutoff` is in **hertz** and `dt` in **milliseconds**, because a pen reports
 * milliseconds and a cutoff is a frequency. The conversion is explicit here
 * rather than left to the caller: mixing the two is a factor of a thousand, and
 * the symptom is a filter that looks like it is working while doing almost
 * nothing — at 120 Hz with `fc = 1` the right answer is α ≈ 0.05, and the unit
 * slip gives 0.98.
 */
export function oneEuroAlpha(cutoff: number, dtMs: number): number {
  const dt = Math.max(dtMs, 1e-6) / MS_PER_SECOND;
  const tau = 1 / (2 * Math.PI * Math.max(cutoff, 1e-6));
  return 1 / (1 + tau / dt);
}

/** One scalar channel, filtered. */
export class OneEuroFilter {
  private readonly options: OneEuroOptions;
  private value: number | null = null;
  private derivative = 0;
  private previousValue: number | null = null;
  private previousTime: number | null = null;

  constructor(options: OneEuroOptions) {
    this.options = options;
  }

  /** The last filtered value, or `null` before the first sample. */
  get last(): number | null {
    return this.value;
  }

  /** The last estimated speed, in value units per millisecond. */
  get speed(): number {
    return Math.abs(this.derivative);
  }

  /** Forget everything. Called at pen-down: a new stroke is a new signal. */
  reset(): void {
    this.value = null;
    this.derivative = 0;
    this.previousValue = null;
    this.previousTime = null;
  }

  /**
   * Filter one sample taken at `time` milliseconds.
   *
   * The first sample of a stroke passes through untouched: there is no previous
   * value to blend with, and a first sample pulled toward zero would make the
   * stroke begin somewhere the pen never was.
   */
  filter(value: number, time: number): number {
    const dt = this.observe(value, time);
    if (dt === null) return this.value!;
    return this.settle(value, dt, this.speed);
  }

  /**
   * The first half of {@link filter}: take the sample in and update the speed
   * estimate, without moving the filtered value yet.
   *
   * Returns the timestep to filter over, or `null` when there is none — the
   * first sample of a stroke (which passes through untouched: a first sample
   * pulled toward zero would begin the stroke somewhere the pen never was), or
   * two samples with the same timestamp, where the estimate simply stands.
   * Snapping to the raw value there would put an unfiltered point into the
   * stroke wherever a platform repeats a sample, and a division by zero would
   * poison every later one.
   *
   * Split from {@link settle} so a 2-D filter can read both axes' speeds before
   * choosing one cutoff for the pair.
   */
  observe(value: number, time: number): number | null {
    if (
      this.value === null ||
      this.previousTime === null ||
      this.previousValue === null
    ) {
      this.value = value;
      this.previousValue = value;
      this.previousTime = time;
      return null;
    }
    const dt = time - this.previousTime;
    if (!(dt > 0)) return null;

    const rawDerivative = (value - this.previousValue) / dt;
    const derivativeAlpha = oneEuroAlpha(this.options.derivativeCutoff, dt);
    this.derivative += derivativeAlpha * (rawDerivative - this.derivative);
    this.previousValue = value;
    this.previousTime = time;
    return dt;
  }

  /** The second half: move the filtered value with the cutoff `speed` earns. */
  settle(value: number, dt: number, speed: number): number {
    const cutoff = this.options.minCutoff + this.options.beta * speed;
    const alpha = oneEuroAlpha(cutoff, dt);
    this.value! += alpha * (value - this.value!);
    return this.value!;
  }
}

/** One sample as it arrives from the digitiser, in 0.1 mm. */
export interface NibSample {
  x: number;
  y: number;
  /** 0–1, or `0`/`0.5` for a device that does not report pressure. */
  pressure: number;
  /** Milliseconds. The filter is entirely in terms of these. */
  t: number;
}

/** A filtered sample: where to draw, how wide, and how fast the pen is moving. */
export interface FilteredNibSample {
  x: number;
  y: number;
  pressure: number;
  /** Speed in 0.1 mm per ms, for the nib's velocity taper. */
  velocity: number;
  t: number;
}

/**
 * The one filter state the pen path owns: position *and* pressure (D13).
 *
 * The two position channels keep their own state but share one cutoff, taken
 * from the pen's speed across the page. The original filter runs each axis on
 * its own speed; see {@link NibFilter.filter} for why that bends corners.
 */
export class NibFilter {
  private readonly x: OneEuroFilter;
  private readonly y: OneEuroFilter;
  private readonly pressure: OneEuroFilter;
  private readonly positionOptions: OneEuroOptions;
  private previous: { x: number; y: number; t: number } | null = null;

  constructor(
    options: { position?: OneEuroOptions; pressure?: OneEuroOptions } = {},
  ) {
    this.positionOptions = options.position ?? INK_POSITION_FILTER;
    this.x = new OneEuroFilter(this.positionOptions);
    this.y = new OneEuroFilter(this.positionOptions);
    this.pressure = new OneEuroFilter(options.pressure ?? INK_PRESSURE_FILTER);
  }

  /** Start a new stroke: no state carries over from the last one. */
  reset(): void {
    this.x.reset();
    this.y.reset();
    this.pressure.reset();
    this.previous = null;
  }

  /**
   * The speed the filter saw, in 0.1 mm per ms, from the *raw* samples.
   *
   * Raw rather than filtered on purpose: the velocity taper is a drawing
   * property, and taking it from the filtered position would make a stroke's
   * width depend on how much the filter happened to be damping at that moment.
   */
  velocityBetween(
    previous: { x: number; y: number; t: number } | null,
    sample: NibSample,
  ): number {
    if (!previous) return 0;
    const dt = sample.t - previous.t;
    if (!(dt > 0)) return 0;
    return Math.hypot(sample.x - previous.x, sample.y - previous.y) / dt;
  }

  /**
   * Filter one sample.
   *
   * A device that does not report pressure has its pressure passed through
   * untouched: filtering `0` toward a previous `0.5` would invent a pressure
   * signal that is not there, and the width would then vary with the filter's
   * state rather than with the hand.
   */
  filter(sample: NibSample): FilteredNibSample {
    const velocity = this.velocityBetween(this.previous, sample);
    const reports =
      Number.isFinite(sample.pressure) &&
      sample.pressure > 0 &&
      sample.pressure !== 0.5;
    // A pen that has reported pressure and now reports `0` has lifted: the
    // `pointerup` on Windows carries no pressure. Taking that `0` as "no
    // channel" would give the last sample the full base width — a blob on the
    // end of a light stroke — so the lift tapers from the last pressure instead.
    const lifted =
      !reports && sample.pressure === 0 && this.pressure.last !== null;
    const pressure = reports
      ? this.pressure.filter(sample.pressure, sample.t)
      : lifted
        ? this.pressure.last! * 0.6
        : sample.pressure;
    // One cutoff for both axes, from the pen's speed along the page rather than
    // each axis's own. Per-axis speed is what the paper does, and it is wrong
    // for handwriting at every corner: at the apex of a "Λ" the y velocity
    // passes through zero while x carries on, so y is filtered at `minCutoff`
    // for a few samples while x is not — the apex is dragged sideways into a
    // shoulder. The pen's speed does not drop at a sharp corner drawn quickly,
    // and neither should the filter's response.
    const dtX = this.x.observe(sample.x, sample.t);
    const dtY = this.y.observe(sample.y, sample.t);
    const speed = Math.hypot(this.x.speed, this.y.speed);
    const filtered = {
      x: dtX === null ? this.x.last! : this.x.settle(sample.x, dtX, speed),
      y: dtY === null ? this.y.last! : this.y.settle(sample.y, dtY, speed),
      pressure,
      velocity,
      t: sample.t,
    };
    this.previous = { x: sample.x, y: sample.y, t: sample.t };
    return filtered;
  }

  /** The filter's own speed estimate for the newest sample, for diagnostics. */
  get speed(): number {
    return Math.hypot(this.x.speed, this.y.speed);
  }
}
