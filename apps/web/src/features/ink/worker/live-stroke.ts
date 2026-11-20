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
  const next = newLiveStroke(stroke.header, true);
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
export function newLiveStroke(header: InkStrokeHeader, raw = false): LiveStroke {
  return {
    header,
    points: [],
    pressures: [],
    realSamples: 0,
    changed: true,
    packer: typedCore().createInkStrokePacker({ tolerance: INK_PACK_TOLERANCE }),
    raw,
  };
}

/**
 * Read a batch into the live stroke, keeping any predicted tail behind it.
 *
 * The arrays are grown once per batch and written by index; a per-sample push of an
 * object would be the same garbage the batched protocol exists to avoid, one thread
 * over. `realSamples` is what separates digitiser truth from prediction.
 */
export function appendSamples(stroke: LiveStroke, payload: InkSamplePayload): void {
  const start = stroke.realSamples;
  const end = start + payload.count;
  stroke.points.length = end * 2;
  stroke.pressures.length = end;
  let index = 0;
  eachInkSample(payload, (sx, sy, pressure) => {
    // A raw (freehand) stroke is stored at whole units, so round here: the wet
    // stroke then matches the saved one exactly. Classic keeps the digitiser value.
    const x = stroke.raw ? Math.round(sx) : sx;
    const y = stroke.raw ? Math.round(sy) : sy;
    stroke.points[(start + index) * 2] = x;
    stroke.points[(start + index) * 2 + 1] = y;
    stroke.pressures[start + index] = readyCore().inkPenPressureByte(pressure);
    stroke.packer.push(x, y, stroke.pressures[start + index]);
    index += 1;
  });
  stroke.realSamples = end;
  stroke.changed = true;
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
  eachInkSample(payload, (x, y, pressure) => {
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
 */
export function liveForRenderer(stroke: LiveStroke): InkLiveStroke {
  const real = stroke.realSamples;
  const { points, pressures } = realSoFar(stroke);
  const realCount = points.length / 2;
  const tail = stroke.points.length / 2 - real;
  const count = realCount + tail;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const pressure = new Uint8Array(count);
  for (let i = 0; i < realCount; i += 1) {
    x[i] = points[i * 2]!;
    y[i] = points[i * 2 + 1]!;
    pressure[i] = pressures[i] ?? 128;
  }
  for (let i = 0; i < tail; i += 1) {
    x[realCount + i] = stroke.points[(real + i) * 2]!;
    y[realCount + i] = stroke.points[(real + i) * 2 + 1]!;
    pressure[realCount + i] = stroke.pressures[real + i] ?? 128;
  }
  return {
    header: stroke.header,
    x,
    y,
    pressure,
    realCount,
  };
}
