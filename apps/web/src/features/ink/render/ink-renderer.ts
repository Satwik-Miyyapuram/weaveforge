/**
 * What a renderer is, and the arithmetic that turns strokes into instances.
 *
 * The interface exists so the WebGL2 path is not the only path (§6.2.10): a
 * context loss, a blocklisted driver or a browser without WebGL2 has to fall back
 * to Canvas 2D without the screen knowing. It is also what keeps the geometry work
 * testable on its own — {@link packStrokeInstances} is pure, and the part that
 * cannot be tested without a GPU is the part that is only shader source.
 *
 * **The geometry model is one instanced quad per segment, expanded in the vertex
 * shader** (§6.2.3). Nothing on the CPU materialises a vertex: 5 000 strokes is
 * 295 000 segments, which as instanced data is 5.9 MB and 0.5 ms to upload, and as
 * a triangle soup is 14.2 MB and 61.7 ms to build. The plan's warning about
 * batching was about Canvas 2D `Path2D`, where one huge path is pathological
 * (1 400 ms); in WebGL many strokes in one draw call is the point.
 *
 * **Joins and caps are analytic.** A single-pass fragment shader computes the
 * distance to the segment and discards outside it, so round caps and round joins
 * come for free, sub-pixel anti-aliasing comes from `fwidth`, there is no notch
 * geometry, and overlapping join discs cannot z-fight or double-blend. That last
 * one is a bug the geometric approach has and this one does not. The price is
 * overdraw — measured at **~1.8–3.1×** on a committed page (§11.3.9), against the
 * 10–15× a review claimed for geometry this engine does not draw.
 */

import {
  INK_PRESSURE_MAX_FACTOR,
  INK_PRESSURE_MIN_FACTOR,
  INK_VELOCITY_TAPER,
  type InkColour,
  type InkTool,
} from "@weaveforge/core";

import type { InkBounds, InkStrokeGeometry } from "../application/page-buffer";
import type { InkPalette } from "./ink-palette";

/** Which renderer is actually drawing. Reported in the status bar. */
export type InkBackend = "webgl2" | "canvas2d" | "none";

/** A translation in page units: where a dragged selection is shown before it lands. */
export interface InkShift {
  x: number;
  y: number;
}

/** How wide the selection halo is, in device pixels, either side of the ink. */
export const INK_SELECTION_HALO_PX = 3;

/**
 * How page units map to the canvas: `css = page * scale + offset`, then
 * `device = css * dpr`. The offset is where the page's corner sits in the
 * canvas, in CSS pixels — negative once the view has scrolled into the page.
 */
export interface InkViewTransform {
  /** CSS pixels per 0.1 mm unit. */
  scale: number;
  /** CSS pixels. */
  offsetX: number;
  offsetY: number;
  devicePixelRatio: number;
}

/** A snapshot of what the renderer is doing, for a status bar or a test. */
export interface InkRenderStats {
  backend: InkBackend;
  /** Strokes resident. */
  strokes: number;
  /** Segments resident — what the draw call iterates. */
  segments: number;
  /** Instances drawn in the last frame. */
  drawn: number;
  /** The AA margin the quads are inflated by, in device pixels. */
  marginPx: number;
}

/** The live stroke, as the renderer takes it: one growing polyline. */
export interface InkLiveStroke {
  header: { strokeId: number; width: number; tool: InkTool; colour: InkColour };
  /** Absolute x per point, in 0.1 mm. */
  x: Float32Array;
  /** Absolute y per point. */
  y: Float32Array;
  /** Pressure per point, 0–255. */
  pressure: Uint8Array;
  /** How many of those points are real rather than predicted. */
  realCount: number;
}

/** A decoded page image, as both renderers can consume it. */
export type InkBackgroundImage = ImageBitmap;

export interface InkRenderer {
  readonly backend: InkBackend;
  /** What the renderer is doing: strokes, segments, the backend. */
  readonly renderStats: InkRenderStats;
  /** Page size and paper, in 0.1 mm. */
  setPage(size: { width: number; height: number }, paper: string): void;
  /**
   * The theme's colours for the six ink names. Posted by the host whenever the
   * theme changes; strokes keep their names and are redrawn in the new values.
   */
  setPalette(palette: InkPalette): void;
  /**
   * The page's background image — an inserted PDF page (§4.8) — stretched to
   * the page and drawn under every stroke, on screen and in an export. `null`
   * clears it. The renderer keeps the image; the caller does not close it.
   */
  setBackground(image: InkBackgroundImage | null): void;
  /**
   * Replace every stroke. The page load path, and the rebuild after a loss.
   *
   * Position is identity: `strokes[i]` is the buffer's stroke `i`, and a `null`
   * is a dead one whose index is still taken. That is what lets `removeStroke`
   * be given a buffer index rather than a position the renderer would have to
   * translate.
   */
  setStrokes(strokes: readonly (InkStrokeGeometry | null)[]): void;
  /**
   * Add one committed stroke without rebuilding anything.
   *
   * `index` is the buffer's; omitted, the renderer assigns the next one, which
   * is the same number so long as the two have been kept in step.
   */
  appendStroke(stroke: InkStrokeGeometry, index?: number): void;
  /** Stop drawing one stroke. `index` is the buffer's, not a position. */
  removeStroke(index: number): void;
  /** The stroke under the pen, redrawn incrementally (D6). */
  setLive(stroke: InkLiveStroke | null): void;
  /**
   * The lasso's selection: these strokes are drawn with a halo, shifted by
   * `shift` page units while a drag is in progress. Empty clears it.
   */
  setSelection(indices: readonly number[], shift: InkShift): void;
  setTransform(transform: InkViewTransform): void;
  /** Resize the drawing surface. CSS pixels; the renderer applies the DPR. */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  /** Paint one frame. */
  draw(): void;
  /**
   * Render the page to PNG at `scale`, for export (§6.2.12).
   *
   * Off an offscreen target, never by reading back the live canvas: a readback
   * from the drawing surface is what `preserveDrawingBuffer` costs, and Chromium
   * demotes a Canvas 2D surface it sees read from. The returned blob is the only
   * thing that leaves.
   */
  capture(scale: number): Promise<Blob | null>;
  /** Everything the renderer holds, released. */
  dispose(): void;
}

/**
 * 12 floats per segment instance: `A.xy, B.xy, rA, rB, prevA.xy, nextB.xy,
 * prevRA, nextRB`.
 *
 * The second half is the instance's neighbours along the stroke: the start and
 * radius of the capsule before it, the end and radius of the one after. A
 * negative neighbour radius means there is none — the instance is the first or
 * last of its stroke. The fragment shader needs them because adjacent capsules
 * overlap, and where two anti-aliased edges overlap they blend twice: a 50 %
 * edge pixel comes out 75 %, so every join along a stroke is a slightly darker
 * band and the edge reads as ribbed. With the neighbours in hand each fragment
 * can tell which capsule it is nearest to, and only that one draws it.
 */
export const INK_INSTANCE_FLOATS = 12;

/**
 * Instances per sample-to-sample segment.
 *
 * The samples are joined by a Hermite spline rather than straight lines: a
 * 120 Hz digitiser puts a sample every millimetre or so on a normal stroke, and
 * a polyline at that spacing has visible corners on every curve. Each span of
 * the spline is drawn as this many capsules, so an instance is about a third
 * of a millimetre and the corners are below the anti-aliasing.
 */
export const INK_SEGMENT_SUBDIVISIONS = 3;

/** How many instances a stroke of `points` samples packs to. */
export function strokeInstanceCount(points: number): number {
  return Math.max(0, points - 1) * INK_SEGMENT_SUBDIVISIONS;
}

/**
 * Uniform Catmull-Rom: the curve through `p1` and `p2` at `u` in [0, 1], with
 * `p0` and `p3` as the neighbours that set the tangents.
 */
export function catmullRom(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  u: number,
): number {
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)
  );
}

/**
 * Turn angle at a sample below which the curve keeps its full tangent, and the
 * angle at which the tangent is gone and the sample is a corner.
 */
/** The turn at which a tangent starts to fade: cos 60°. Zero by 90°. */
const INK_CORNER_SOFT_COS = Math.cos(Math.PI / 3);

/**
 * The tangent of the stroke at sample `i`, for the Hermite span on `side`.
 *
 * Uniform Catmull-Rom takes `(p[i+1] - p[i-1]) / 2` for both spans. That is
 * right when the samples are evenly spaced, and they are not by the time a
 * stroke is committed: the save-time simplification keeps a point only where
 * the centreline bends, so a straight run becomes one long span next to a
 * short one. The same tangent on both sides is then scaled to the long span
 * and overshoots the short one — a hooked spur at every corner of a box, a
 * loop at the point of a `v`. So:
 *
 * - the **direction** is Catmull-Rom's, the sum of the two chords. Weighted by
 *   length like that, a long edge is not turned by the short chord the
 *   simplifier left at its corner. (On a circle the exact tangent is the
 *   bisector of the chords; with spans two to four times apart the weighted
 *   sum is a few degrees off it, which is under a tenth of a millimetre on
 *   the arc — the bisector's failure at a corner is a full millimetre.)
 * - the **magnitude** is the length of the span the tangent is for, so a span
 *   is bent by its own length and never by its neighbour's. On evenly spaced
 *   samples this *is* Catmull-Rom; on uneven ones the direction is shared and
 *   the curve is G1 rather than C1, which the eye cannot tell.
 * - the magnitude fades with the turn angle, from 60° to nothing at 90°, so a
 *   true corner is drawn as one. Not sooner: handwriting turns 30–45° between
 *   neighbouring simplified samples, and a fade from 30° drew it as a
 *   polyline.
 *
 * At either end of the stroke the tangent is the one chord there, which makes
 * the end span a straight, evenly-parametrised run into the cap.
 */
export function strokeTangentAt(
  stroke: StrokeInstanceInput,
  i: number,
  side: "in" | "out" = "out",
): { x: number; y: number } {
  const count = Math.min(stroke.x.length, stroke.y.length);
  const x = stroke.x[i]!;
  const y = stroke.y[i]!;
  const hasPrev = i > 0;
  const hasNext = i + 1 < count;
  const px = hasPrev ? x - stroke.x[i - 1]! : 0;
  const py = hasPrev ? y - stroke.y[i - 1]! : 0;
  const nx = hasNext ? stroke.x[i + 1]! - x : 0;
  const ny = hasNext ? stroke.y[i + 1]! - y : 0;
  const pl = Math.hypot(px, py);
  const nl = Math.hypot(nx, ny);
  if (!(pl > 0) && !(nl > 0)) return { x: 0, y: 0 };
  if (!(pl > 0)) return { x: nx, y: ny };
  if (!(nl > 0)) return { x: px, y: py };
  const sx = px + nx;
  const sy = py + ny;
  const sl = Math.hypot(sx, sy);
  if (!(sl > 0)) return { x: 0, y: 0 };
  const cos = (px * nx + py * ny) / (pl * nl);
  const corner = Math.max(0, Math.min(1, cos / INK_CORNER_SOFT_COS));
  const magnitude = (side === "out" ? nl : pl) * corner;
  return { x: (sx / sl) * magnitude, y: (sy / sl) * magnitude };
}

/**
 * A point on the stroke's curve between samples `i` and `i + 1`, and the nib
 * radius there: a cubic Hermite span through the two samples with the tangents
 * {@link strokeTangentAt} gives them.
 */
export function strokeCurveAt(
  stroke: StrokeInstanceInput,
  i: number,
  u: number,
  velocityScale?: number,
): { x: number; y: number; r: number } {
  const x1 = stroke.x[i]!;
  const y1 = stroke.y[i]!;
  const x2 = stroke.x[i + 1]!;
  const y2 = stroke.y[i + 1]!;
  const m1 = strokeTangentAt(stroke, i, "out");
  const m2 = strokeTangentAt(stroke, i + 1, "in");
  const uu = u * u;
  const uuu = uu * u;
  const h00 = 2 * uuu - 3 * uu + 1;
  const h10 = uuu - 2 * uu + u;
  const h01 = -2 * uuu + 3 * uu;
  const h11 = uuu - uu;
  return {
    x: h00 * x1 + h10 * m1.x + h01 * x2 + h11 * m2.x,
    y: h00 * y1 + h10 * m1.y + h01 * y2 + h11 * m2.y,
    r:
      radiusAt(stroke, i, velocityScale) * (1 - u) +
      radiusAt(stroke, i + 1, velocityScale) * u,
  };
}

/**
 * Anti-aliasing margin, in device pixels.
 *
 * The plan's lever on overdraw is to keep this at ~1 px rather than inflating the
 * quad generously: the margin is what makes adjacent quads overlap even when the
 * stroke does not, so it is paid for on every segment. At 1 px the measured
 * overdraw is 1.8–3.1× on a committed page (§11.3.9).
 */
export const INK_AA_MARGIN_PX = 1;

/**
 * The most device pixels a page canvas is given. The canvas covers the whole
 * page, so at 4× zoom on a 2× display an A4 page would want 8700 × 12300 px —
 * 430 MB of colour alone, plus the stencil — and the GPU refuses the
 * allocation, which shows as the ink vanishing at some zoom level. Above this
 * budget the backing store's pixel ratio is lowered instead (`backingRatio`),
 * so the page stays drawn, slightly softer than the display could show.
 * 20 M px is 80 MB of colour: 4000 × 5000, or the page at ~2.4× on this
 * machine's 1.25× display, before any softening.
 */
export const INK_MAX_BACKING_PIXELS = 20_000_000;

/** The largest single dimension a backing store is allowed, under WebGL's floor. */
export const INK_MAX_BACKING_DIMENSION = 8192;

/**
 * The pixel ratio a canvas of `cssWidth × cssHeight` is given: the display's,
 * unless the backing store would exceed `INK_MAX_BACKING_PIXELS` or
 * `INK_MAX_BACKING_DIMENSION`, in which case as much of it as fits.
 */
export function backingRatio(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): number {
  const w = Math.max(1, cssWidth);
  const h = Math.max(1, cssHeight);
  const byArea = Math.sqrt(INK_MAX_BACKING_PIXELS / (w * h));
  const byEdge = INK_MAX_BACKING_DIMENSION / Math.max(w, h);
  return Math.max(0.1, Math.min(devicePixelRatio, byArea, byEdge));
}

/**
 * The half-extent of the quad that encloses a segment, per axis.
 *
 * This is the one piece of the SDF pipeline that is CPU arithmetic, and it is
 * where the plan's zero-length case is decided: a segment whose endpoints coincide
 * is a **dot**, and the quad must be a square of `radius + margin` around it or the
 * fragment shader has a degenerate `ba` to divide by. The shader guards that
 * division separately (`max(dot(ba, ba), epsilon)`); this guards the geometry.
 */
export function capsuleHalfExtent(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  margin: number,
): {
  halfWidth: number;
  halfHeight: number;
  length: number;
  degenerate: boolean;
} {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  const half = radius + margin;
  if (length <= half) {
    // Short enough to be a dot: a square covers it whatever the direction, and a
    // direction is not defined anyway.
    return { halfWidth: half, halfHeight: half, length, degenerate: true };
  }
  // The quad is the segment's own box grown by the nib and the AA margin.
  const halfWidth = Math.abs(dx) / 2 + half;
  const halfHeight = Math.abs(dy) / 2 + half;
  return { halfWidth, halfHeight, length, degenerate: false };
}

/** One stroke's rendering inputs, as the packer needs them. */
export interface StrokeInstanceInput {
  x: Float32Array;
  y: Float32Array;
  pressure: Uint8Array;
  /** Base nib width in 0.1 mm. */
  width: number;
  /**
   * Whether the nib narrows and widens with the hand.
   *
   * A highlighter and a snapped shape do not: their width is the tool's, and a
   * 6 mm marker that tapered with pressure would not be a marker.
   */
  variableWidth: boolean;
}

/**
 * Pack a stroke's segments into instance data.
 *
 * `INK_SEGMENT_SUBDIVISIONS` instances per segment, `A.xy, B.xy, rA, rB`, where
 * a radius is the nib width at that point. The taper is `f(width, pressure,
 * velocity)` from §6.2.5, and the velocity half of it is computed here from the
 * positions because that is where the positions are: a fast stroke thins, a
 * slow one keeps its width, and the pressure the device reported scales
 * between them.
 *
 * `out` is written into rather than allocated, because this runs once per stroke
 * at commit time and once per *frame* for the live stroke. It must be at least
 * `strokeInstanceCount(points) * INK_INSTANCE_FLOATS` long; the writer returns
 * how many floats it used so a pooled buffer can be reused. `from` is the first
 * *segment* to pack — a live stroke re-packs its last segment when the next
 * sample lands, because that sample sets the tangent the segment curves with.
 */
export function packStrokeInstances(
  stroke: StrokeInstanceInput,
  out: Float32Array,
  options: { from?: number; velocityScale?: number } = {},
): number {
  const from = options.from ?? 0;
  const count = Math.min(stroke.x.length, stroke.y.length);
  const segments = Math.max(0, count - 1);
  const last = INK_SEGMENT_SUBDIVISIONS;
  const at = (i: number, k: number) =>
    strokeCurveAt(stroke, i, k / last, options.velocityScale);
  let cursor = 0;
  // Every instance carries its neighbours, so the sub-segment before the first
  // packed one is evaluated too even though it is not written: when a live
  // stroke re-packs its tail the first instance still needs to know what it
  // joins onto.
  let prev = from > 0 ? at(from - 1, last - 1) : null;
  for (let i = from; i < segments; i += 1) {
    let a = at(i, 0);
    for (let k = 1; k <= last; k += 1) {
      const b = at(i, k);
      const next =
        k < last ? at(i, k + 1) : i + 1 < segments ? at(i + 1, 1) : null;
      const base = cursor * INK_INSTANCE_FLOATS;
      out[base] = a.x;
      out[base + 1] = a.y;
      out[base + 2] = b.x;
      out[base + 3] = b.y;
      out[base + 4] = a.r;
      out[base + 5] = b.r;
      out[base + 6] = prev ? prev.x : 0;
      out[base + 7] = prev ? prev.y : 0;
      out[base + 8] = next ? next.x : 0;
      out[base + 9] = next ? next.y : 0;
      out[base + 10] = prev ? prev.r : -1;
      out[base + 11] = next ? next.r : -1;
      cursor += 1;
      prev = a;
      a = b;
    }
  }
  return cursor * INK_INSTANCE_FLOATS;
}

/** Samples either side of a point that its speed is averaged over. */
const RADIUS_SPEED_WINDOW = 4;

/**
 * The nib radius at one point, in 0.1 mm.
 *
 * Pressure and speed together, which is the taper D3 exists for. A device with no
 * pressure channel reports `0` (or `0.5` for a mouse) and gets the base width; a
 * highlighter or a shape gets it too, because {@link StrokeInstanceInput.variableWidth}
 * says so.
 */
export function radiusAt(
  stroke: StrokeInstanceInput,
  index: number,
  velocityScale = 4,
): number {
  const base = stroke.width / 2;
  if (!stroke.variableWidth) return base;
  const raw = stroke.pressure[index] ?? 0;
  // 0 means "no pressure channel" and 0.5 is a mouse; neither should taper. A
  // pen scales over core's full range — a light touch is little over half the
  // nib and a firm press half again as wide — because that swing, not the
  // spline, is most of what makes a stroke read as written with a pen.
  const pressure = raw === 0 ? 0.5 : raw / 255;
  const pressureScale =
    raw === 0
      ? 1
      : INK_PRESSURE_MIN_FACTOR +
        pressure * (INK_PRESSURE_MAX_FACTOR - INK_PRESSURE_MIN_FACTOR);
  // Speed in 0.1 mm per sample rather than per millisecond: the sample rate is not
  // in this data, and the taper only needs "how fast relative to a stroke". It is
  // read over a window of samples, not the two neighbours: a digitiser's spacing
  // jitters from sample to sample, and a width that followed it would scallop.
  const previous = Math.max(0, index - RADIUS_SPEED_WINDOW);
  const next = Math.min(stroke.x.length - 1, index + RADIUS_SPEED_WINDOW);
  let span = 0;
  for (let i = previous; i < next; i += 1)
    span += Math.hypot(
      stroke.x[i + 1]! - stroke.x[i]!,
      stroke.y[i + 1]! - stroke.y[i]!,
    );
  const speed = span / Math.max(1, next - previous);
  const velocityScaleFactor =
    1 - Math.min(1, speed / velocityScale) * INK_VELOCITY_TAPER;
  return base * pressureScale * velocityScaleFactor;
}

/** The colour a stroke paints with, as a palette index the shader reads. */
export function colourIndex(
  colour: InkColour,
  palette: readonly InkColour[],
): number {
  const index = palette.indexOf(colour);
  return index < 0 ? 0 : index;
}

/** Whether a stroke is drawn translucent and deduped through the stencil. */
export function usesHighlighterPass(tool: InkTool): boolean {
  return tool === "highlighter";
}

/** The page's drawn extent, which is what an export has to contain. */
export function pageExtent(
  width: number,
  height: number,
  transform: InkViewTransform,
): { width: number; height: number } {
  return {
    width: Math.max(
      1,
      Math.round(width * transform.scale * transform.devicePixelRatio),
    ),
    height: Math.max(
      1,
      Math.round(height * transform.scale * transform.devicePixelRatio),
    ),
  };
}

/** A page-unit box as canvas pixels, for a debug overlay or a hit-test box. */
export function boundsToClip(
  bounds: InkBounds,
  transform: InkViewTransform,
): { x: number; y: number; width: number; height: number } {
  const scale = transform.scale * transform.devicePixelRatio;
  return {
    x: bounds[0] * scale + transform.offsetX * transform.devicePixelRatio,
    y: bounds[1] * scale + transform.offsetY * transform.devicePixelRatio,
    width: (bounds[2] - bounds[0]) * scale,
    height: (bounds[3] - bounds[1]) * scale,
  };
}
