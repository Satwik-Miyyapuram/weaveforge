import { readyCore, typedCore } from "@/lib/rust-core";
import { INK_PACK_TOLERANCE, type LiveInkStrokePacker, type PackedInkStroke } from "@weaveforge/core";
import { eachInkSample, type InkSamplePayload, type InkStrokeHeader } from "../application/capture-protocol";
import type { InkLiveStroke } from "../render/parts-1";

/**
 * The stroke the pen is drawing, as the ink worker holds it: real samples,
 * the predicted tail behind them, and the split at the page format's point
 * cap. Pure data handling, apart from the worker's message pump.
 */

/** The stroke being drawn: raw samples, with its predicted tail marked off. */
export interface LiveStroke {
  header: InkStrokeHeader;
  points: number[];
  pressures: number[];
  /**
   * Samples that came from the digitiser rather than from prediction.
   *
   * `getPredictedEvents()` extrapolates one or two frames ahead, and the worker
   * draws that tail so the ink keeps up with the nib. It must never be committed:
   * a prediction is a guess about a hand, and a saved guess is a corrupted note.
   * The next real batch truncates back to here.
   */
  realSamples: number;
  /** Samples arrived since the renderer last got this stroke; a frame without new ones repacks nothing (19-09). */
  changed: boolean;
  /** The real samples, packed as they arrive: what is drawn and what is saved, unless `raw`. */
  packer: LiveInkStrokePacker;
  /**
   * Freehand keeps every real sample, drawn and saved, so the outline has the
   * pen's own density. Classic keeps what the packer simplifies to.
   */
  raw: boolean;
  /** What the renderer is handed, reused frame to frame; made on the first frame. */
  wet?: WetBuffers;
  /** The input knobs (`ink.tuning`) this stroke began with; absent when both are off. */
  input?: InkInputFilter | null;
}

/** A stroke's input knobs, from `ink.tuning` when it begins; 0 turns one off. */
export interface InkInputSettings {
  /** Average each position with up to this many previous raw ones. */
  inputSmoothing: number;
  /** Drop a sample closer than this (stroke units) to the last one kept. */
  resampleSpacing: number;
}

/** The filter for `settings`, or null when both knobs are off, so the default path is untouched. */
export function inkInputFilter(settings: InkInputSettings | undefined): InkInputFilter | null {
  if (!settings) return null;
  if (Math.floor(settings.inputSmoothing) <= 0 && !(settings.resampleSpacing > 0)) return null;
  return new InkInputFilter(settings);
}

/**
 * Filters raw pen samples before the stroke keeps them. Smoothing is a causal
 * moving average over the last `inputSmoothing` raw positions and the new one.
 * Resampling drops a sample within `resampleSpacing` of the last kept one;
 * `flush` hands back the last dropped sample, so the stroke still ends where the
 * pen lifted. Results go to the `x`, `y`, `pressure` fields rather than a
 * fresh tuple, so a sample costs no garbage.
 */
export class InkInputFilter {
  x = 0;
  y = 0;
  pressure = 0;
  private readonly window: number;
  private readonly spacing: number;
  private readonly recentX: number[] = [];
  private readonly recentY: number[] = [];
  private keptX = Number.NaN;
  private keptY = Number.NaN;
  private held = false;
  private heldX = 0;
  private heldY = 0;
  private heldPressure = 0;

  constructor(settings: InkInputSettings) {
    this.window = Math.max(0, Math.floor(settings.inputSmoothing));
    this.spacing = Math.max(0, settings.resampleSpacing);
  }

  /** Filter a real sample; false when resampling drops it. */
  accept(x: number, y: number, pressure: number): boolean {
    this.smooth(x, y);
    if (this.window > 0) {
      this.recentX.push(x);
      this.recentY.push(y);
      if (this.recentX.length > this.window) {
        this.recentX.shift();
        this.recentY.shift();
      }
    }
    this.pressure = pressure;
    if (
      this.spacing > 0 &&
      !Number.isNaN(this.keptX) &&
      Math.hypot(this.x - this.keptX, this.y - this.keptY) < this.spacing
    ) {
      this.held = true;
      this.heldX = this.x;
      this.heldY = this.y;
      this.heldPressure = pressure;
      return false;
    }
    this.keep();
    return true;
  }

  /** The last sample `accept` dropped, if any, now kept: the stroke's end. */
  flush(): boolean {
    if (!this.held) return false;
    this.x = this.heldX;
    this.y = this.heldY;
    this.pressure = this.heldPressure;
    this.keep();
    return true;
  }

  /** Smooth a predicted sample against the real ones, without remembering it. */
  preview(x: number, y: number): void {
    this.smooth(x, y);
  }

  private keep(): void {
    this.keptX = this.x;
    this.keptY = this.y;
    this.held = false;
  }

  private smooth(x: number, y: number): void {
    let sx = x;
    let sy = y;
    for (let i = 0; i < this.recentX.length; i += 1) {
      sx += this.recentX[i]!;
      sy += this.recentY[i]!;
    }
    const n = this.recentX.length + 1;
    this.x = sx / n;
    this.y = sy / n;
  }
}

/**
 * The most points the page format holds per stroke (the Rust `INK_STROKE_MAX_POINTS`).
 * A raw stroke that reaches it is split (`takeRawOverflow`), never packed.
 */
export const RAW_STROKE_MAX_POINTS = 65_535;

/** The cap `takeRawOverflow` uses; only tests lower it, so a split test stays fast. */
let rawStrokeCap = RAW_STROKE_MAX_POINTS;

/** Test hook: set the raw point cap; no argument restores `RAW_STROKE_MAX_POINTS`. */
export function setRawStrokeCapForTest(cap = RAW_STROKE_MAX_POINTS): void {
  rawStrokeCap = cap;
}

/** What the live packer holds so far, as plain arrays. */
function packedSoFar(packer: LiveInkStrokePacker): PackedInkStroke {
  return { points: Array.from(packer.points()), pressures: Array.from(packer.pressures()) };
}

/** The real samples as the stroke keeps them: every one if `raw`, else what the packer kept. */
export function realSoFar(stroke: LiveStroke): PackedInkStroke {
  if (stroke.raw) {
    return {
      points: stroke.points.slice(0, stroke.realSamples * 2),
      pressures: stroke.pressures.slice(0, stroke.realSamples),
    };
  }
  return packedSoFar(stroke.packer);
}

/**
 * Split a raw stroke that has passed the point cap: the stroke keeps its first
 * `RAW_STROKE_MAX_POINTS` samples and the rest move to a new live stroke, which
 * starts at the last kept sample so the line stays joined. Null when the stroke
 * fits. Raw vs packed is decided when the stroke begins and never changes, so
 * the outline does not change shape mid-stroke. The cost: a stroke this long
 * saves as two strokes and undoes in two steps.
 *
 * Call it right after `appendSamples`, when there is no predicted tail.
 */
export function takeRawOverflow(stroke: LiveStroke): LiveStroke | null {
  const cap = rawStrokeCap;
  if (!stroke.raw || stroke.realSamples <= cap) return null;
  const next = newLiveStroke(stroke.header, true, stroke.input);
  for (let i = cap - 1; i < stroke.realSamples; i += 1) {
    const x = stroke.points[i * 2]!;
    const y = stroke.points[i * 2 + 1]!;
    const pressure = stroke.pressures[i]!;
    next.points.push(x, y);
    next.pressures.push(pressure);
    next.packer.push(x, y, pressure);
  }
  next.realSamples = stroke.realSamples - cap + 1;
  stroke.points.length = cap * 2;
  stroke.pressures.length = cap;
  stroke.realSamples = cap;
  stroke.changed = true;
  return next;
}

/** A stroke the pen has just put down, with nothing in it yet. */
export function newLiveStroke(
  header: InkStrokeHeader,
  raw = false,
  input: InkInputFilter | null = null,
): LiveStroke {
  return {
    header,
    points: [],
    pressures: [],
    realSamples: 0,
    changed: true,
    packer: typedCore().createInkStrokePacker({ tolerance: INK_PACK_TOLERANCE }),
    raw,
    input,
  };
}

/**
 * Read a batch into the live stroke, keeping any predicted tail behind it.
 *
 * The arrays are grown once per batch and written by index; a per-sample push of an
 * object would be the same garbage the batched protocol exists to avoid, one thread
 * over. `realSamples` is what separates digitiser truth from prediction. The
 * stroke's input filter, if any, smooths each sample and may drop it.
 */
export function appendSamples(stroke: LiveStroke, payload: InkSamplePayload): void {
  const start = stroke.realSamples;
  stroke.points.length = (start + payload.count) * 2;
  stroke.pressures.length = start + payload.count;
  const input = stroke.input;
  let end = start;
  eachInkSample(payload, (sx, sy, pressure) => {
    if (input) {
      if (!input.accept(sx, sy, pressure)) return;
      keepSample(stroke, end, input.x, input.y, pressure);
    } else keepSample(stroke, end, sx, sy, pressure);
    end += 1;
  });
  stroke.points.length = end * 2;
  stroke.pressures.length = end;
  stroke.realSamples = end;
  stroke.changed = true;
}

/** On pen lift: keep the last sample the input filter dropped, so the stroke ends at the nib. */
export function finishSamples(stroke: LiveStroke): void {
  if (!stroke.input?.flush()) return;
  const at = stroke.realSamples;
  stroke.points.length = at * 2;
  stroke.pressures.length = at;
  keepSample(stroke, at, stroke.input.x, stroke.input.y, stroke.input.pressure);
  stroke.realSamples = at + 1;
  stroke.changed = true;
}

function keepSample(stroke: LiveStroke, at: number, sx: number, sy: number, pressure: number): void {
  // A raw (freehand) stroke is stored at whole units, so round here: the wet
  // stroke then matches the saved one exactly. Classic keeps the digitiser value.
  const x = stroke.raw ? Math.round(sx) : sx;
  const y = stroke.raw ? Math.round(sy) : sy;
  stroke.points[at * 2] = x;
  stroke.points[at * 2 + 1] = y;
  stroke.pressures[at] = readyCore().inkPenPressureByte(pressure);
  stroke.packer.push(x, y, stroke.pressures[at]);
}

/**
 * Replace the predicted tail: truncate to the last real sample, then append.
 * A raw stroke rounds the tail to whole units, as `appendSamples` rounds the
 * real samples.
 */
export function replacePredictedTail(
  stroke: LiveStroke,
  payload: InkSamplePayload,
): void {
  stroke.points.length = stroke.realSamples * 2;
  stroke.pressures.length = stroke.realSamples;
  const input = stroke.input;
  eachInkSample(payload, (px, py, pressure) => {
    input?.preview(px, py);
    const x = input ? input.x : px;
    const y = input ? input.y : py;
    stroke.points.push(stroke.raw ? Math.round(x) : x, stroke.raw ? Math.round(y) : y);
    stroke.pressures.push(readyCore().inkPenPressureByte(pressure));
  });
  stroke.changed = true;
}

/**
 * The live stroke as the renderer takes it.
 *
 * The real samples are what the packer has kept, which `commitStroke` saves as
 * they are, so lifting the pen changes nothing on screen. The predicted tail is
 * kept out of the packer and drawn after, as sampled.
 *
 * `changedFrom` is the first point that differs from the last frame's, so the
 * WebGL renderer repacks from there rather than assuming only the newest
 * segments moved: a raw stroke only appends (or is cut back), so it is where the
 * new samples start; a classic stroke is compared point by point, because the
 * packer may revise kept points anywhere.
 */
export function liveForRenderer(stroke: LiveStroke): InkLiveStroke {
  const real = stroke.realSamples;
  const tail = Math.max(0, stroke.points.length / 2 - real);
  const wet = (stroke.wet ??= newWetBuffers(stroke.header));
  const drawn = wet.drawn;
  let changedFrom: number;
  let realCount: number;
  if (stroke.raw) {
    // Raw samples are only ever appended (or cut back at the point cap), so
    // the prefix already copied is still right: copy only the new ones.
    realCount = real;
    growWet(wet, realCount + tail);
    changedFrom = Math.min(wet.copied, realCount);
    for (let i = changedFrom; i < realCount; i += 1) {
      wet.x[i] = stroke.points[i * 2]!;
      wet.y[i] = stroke.points[i * 2 + 1]!;
      wet.pressure[i] = stroke.pressures[i] ?? 128;
    }
    wet.copied = realCount;
  } else {
    // Not append-only, and cannot be without a new core API: the packer moves
    // its last point with the pen and may revise the kept ones, and `points()`
    // copies the whole stroke out of wasm on every call, so the packed part is
    // rewritten each frame, into the same buffers. A `points_from(i)` in core
    // (and a wasm rebuild) would make it incremental. Meanwhile the copy finds
    // the first point that really changed, so the GPU repack stays local.
    const points = stroke.packer.points();
    const pressures = stroke.packer.pressures();
    realCount = points.length / 2;
    growWet(wet, realCount + tail);
    changedFrom = Number.POSITIVE_INFINITY;
    for (let i = 0; i < realCount; i += 1) {
      if (setWet(wet, i, points[i * 2]!, points[i * 2 + 1]!, pressures[i] ?? 128, drawn)) {
        changedFrom = Math.min(changedFrom, i);
      }
    }
  }
  for (let i = 0; i < tail; i += 1) {
    const at = realCount + i;
    if (setWet(wet, at, stroke.points[(real + i) * 2]!, stroke.points[(real + i) * 2 + 1]!, stroke.pressures[real + i] ?? 128, drawn)) {
      changedFrom = Math.min(changedFrom, at);
    }
  }
  const count = realCount + tail;
  wet.drawn = count;
  const live = wet.live;
  live.header = stroke.header;
  live.x = wet.x.subarray(0, count);
  live.y = wet.y.subarray(0, count);
  live.pressure = wet.pressure.subarray(0, count);
  live.realCount = realCount;
  live.changedFrom = Math.min(changedFrom, count);
  return live;
}

/**
 * The wet stroke's buffers, kept on the live stroke between frames (perf
 * review I1/I2). `live` is the one object the renderer gets every frame: the
 * WebGL renderer packs incrementally only while it sees the same object, and
 * a fresh one per frame made it repack (and re-upload) the whole stroke.
 */
export interface WetBuffers {
  x: Float32Array;
  y: Float32Array;
  pressure: Uint8Array;
  /** Raw samples already copied in; the prefix that need not be copied again. */
  copied: number;
  /** Points handed to the renderer last frame, real and predicted. */
  drawn: number;
  live: InkLiveStroke;
}

function newWetBuffers(header: InkStrokeHeader): WetBuffers {
  const x = new Float32Array(256);
  const y = new Float32Array(256);
  const pressure = new Uint8Array(256);
  return { x, y, pressure, copied: 0, drawn: 0, live: { header, x, y, pressure, realCount: 0 } };
}

/** Write one wet point; true when it differs from what was drawn there last frame. */
function setWet(wet: WetBuffers, i: number, x: number, y: number, pressure: number, drawn: number): boolean {
  const was = i < drawn ? wet.x[i] : undefined;
  const wasY = wet.y[i];
  const wasPressure = wet.pressure[i];
  wet.x[i] = x;
  wet.y[i] = y;
  wet.pressure[i] = pressure;
  return was === undefined || wet.x[i] !== was || wet.y[i] !== wasY || wet.pressure[i] !== wasPressure;
}

/** Grow by doubling, keeping what is in the buffers. */
function growWet(wet: WetBuffers, count: number): void {
  if (count <= wet.x.length) return;
  let size = wet.x.length;
  while (size < count) size *= 2;
  const x = new Float32Array(size);
  const y = new Float32Array(size);
  const pressure = new Uint8Array(size);
  x.set(wet.x);
  y.set(wet.y);
  pressure.set(wet.pressure);
  wet.x = x;
  wet.y = y;
  wet.pressure = pressure;
}
