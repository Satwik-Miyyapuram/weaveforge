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

import type { InkColour, InkTool } from "@weaveforge/core";

import type { InkBounds, InkStrokeGeometry } from "../application/page-buffer";

/** Which renderer is actually drawing. Reported in the status bar. */
export type InkBackend = "webgl2" | "canvas2d" | "none";

/** How page units map to the canvas: `device = page * scale * dpr + offset`. */
export interface InkViewTransform {
  /** CSS pixels per 0.1 mm unit. */
  scale: number;
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

/** 6 floats per segment instance: A.xy, B.xy, rA, rB. */
export const INK_INSTANCE_FLOATS = 6;

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
 * One instance per segment, `A.xy, B.xy, rA, rB`, where a radius is the nib width
 * at that point. The taper is `f(width, pressure, velocity)` from §6.2.5, and the
 * velocity half of it is computed here from the positions because that is where
 * the positions are: a fast stroke thins, a slow one keeps its width, and the
 * pressure the device reported scales between them.
 *
 * `out` is written into rather than allocated, because this runs once per stroke
 * at commit time and once per *frame* for the live stroke. It must be at least
 * `segments * INK_INSTANCE_FLOATS` long; the writer returns how many floats it
 * used so a pooled buffer can be reused.
 */
export function packStrokeInstances(
  stroke: StrokeInstanceInput,
  out: Float32Array,
  options: { from?: number; velocityScale?: number } = {},
): number {
  const from = options.from ?? 0;
  const count = Math.min(stroke.x.length, stroke.y.length);
  let cursor = 0;
  for (let i = from; i + 1 < count; i += 1) {
    const ax = stroke.x[i]!;
    const ay = stroke.y[i]!;
    const bx = stroke.x[i + 1]!;
    const by = stroke.y[i + 1]!;
    const at = cursor * INK_INSTANCE_FLOATS;
    out[at] = ax;
    out[at + 1] = ay;
    out[at + 2] = bx;
    out[at + 3] = by;
    out[at + 4] = radiusAt(stroke, i, options.velocityScale);
    out[at + 5] = radiusAt(stroke, i + 1, options.velocityScale);
    cursor += 1;
  }
  return cursor * INK_INSTANCE_FLOATS;
}

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
  // 0 means "no pressure channel" and 0.5 is a mouse; neither should taper.
  const pressure = raw === 0 ? 0.5 : raw / 255;
  const pressureScale = raw === 0 ? 1 : 0.75 + pressure * 0.5;
  const previous = Math.max(0, index - 1);
  const next = Math.min(stroke.x.length - 1, index + 1);
  const span = Math.hypot(
    stroke.x[next]! - stroke.x[previous]!,
    stroke.y[next]! - stroke.y[previous]!,
  );
  // Speed in 0.1 mm per sample rather than per millisecond: the sample rate is not
  // in this data, and the taper only needs "how fast relative to a stroke".
  const speed = span / Math.max(1, next - previous);
  const velocityScaleFactor = 1 - Math.min(1, speed / velocityScale) * 0.3;
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
    x: bounds[0] * scale + transform.offsetX,
    y: bounds[1] * scale + transform.offsetY,
    width: (bounds[2] - bounds[0]) * scale,
    height: (bounds[3] - bounds[1]) * scale,
  };
}
