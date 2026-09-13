/// <reference lib="webworker" />

/**
 * The ink worker: it owns the page, the renderer and the pen's render loop.
 *
 * Why the worker is not optional (§6.2.2): this app's main thread runs React,
 * CodeMirror, Yjs, file indexing and wiki lint, and measured tasks there reach
 * **16–74 ms** — one keystroke is 2–9 dropped frames at 120 Hz. Whatever draws ink
 * must not be in that queue. So the whole pipeline is here and the main thread does
 * three things: gate the pointer, filter the sample, forward a batch.
 *
 * What this worker owns:
 *
 * - the canvas, through `transferControlToOffscreen`, and the WebGL2 context on it
 *   with the attributes §6.2.8 chooses **per path** — `desynchronized: false` while
 *   the delegated trail is drawing the wet tail, `true` when it is not;
 * - the page's geometry ({@link InkPageBuffer}) and the R-tree over it
 *   ({@link InkStrokeIndex}), so a pick never costs the main thread a milisecond;
 * - the live stroke, with its predicted tail **replaced rather than committed**;
 * - packing a finished stroke with core's pressure-aware `packInkStroke` — the same
 *   function the sidecar uses, so what is drawn and what is stored cannot drift;
 * - a one-byte progress counter every frame, which is what the delegated trail
 *   reads to decide whether the worker is rendering behind (§6.2.6).
 *
 * It does not own the *decision* to use the delegated trail: the presenter lives on
 * the main thread, which tells the worker which path it is on through `viewport`
 * and expects a canvas choice made before the first `getContext` — attributes are
 * immutable and the first call wins silently, so a presenter that appears late has
 * to recreate the canvas rather than flip an attribute.
 */

import {
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  decodeInkChunk,
  encodeInkChunk,
  packInkStroke,
  pageFromChunk,
  type InkChunkCodec,
  type InkPage,
  type InkShape,
  smoothInkStroke,
} from "@weaveforge/core";

import {
  eachInkSample,
  type InkSamplePayload,
  type InkStrokeHeader,
  type InkTransferMode,
  type InkWorkerEvent,
  type InkWorkerMessage,
} from "../application/capture-protocol";
// The codec lives with the rest of the chunk plumbing rather than here: the
// host writes a page's chunk too, when its background changes (§4.8).
import { inkChunkCodec } from "../application/ink-chunk-codec";
import {
  InkPageBuffer,
  boundsOf,
  type InkBounds,
} from "../application/page-buffer";
import type { InkPalette } from "../render/ink-palette";
import {
  fittedArrowPaths,
  fittedInkPath,
  recogniseShape,
} from "../application/shape-snap";
import { InkStrokeIndex } from "../application/stroke-index";
import { CanvasInkRenderer } from "../render/canvas-renderer";
import { WebglInkRenderer, supportsWebglInk } from "../render/webgl-renderer";
import type { InkLiveStroke, InkRenderer } from "../render/ink-renderer";

/** A stroke as the worker holds it once the pen has left the page. */
export interface CommittedStroke {
  header: InkStrokeHeader;
  /** `[x, y, …]` in 0.1 mm, absolute, after simplification. */
  points: Float32Array;
  /** Pressure per point, 0–255. */
  pressures: Float32Array;
}

/** The stroke being drawn: raw samples, with its predicted tail marked off. */
interface LiveStroke {
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
}

/** One undoable step. `indices` are buffer indices; a move also carries its delta. */
type HistoryStep =
  | { kind: "erase"; indices: number[] }
  | { kind: "draw"; indices: number[] }
  | { kind: "move"; indices: number[]; dx: number; dy: number };

/** What the worker holds. Fields rather than a class: it is a process, not an object. */
const state = {
  canvas: null as OffscreenCanvas | null,
  width: INK_A4_WIDTH,
  height: INK_A4_HEIGHT,
  dpr: 1,
  mode: "transfer" as InkTransferMode,
  frame: 0,
  running: false,
  disposed: false,
  live: null as LiveStroke | null,
  pageIndex: 0,
  buffer: new InkPageBuffer({
    width: INK_A4_WIDTH,
    height: INK_A4_HEIGHT,
    paper: "blank",
    background: 0,
    strokes: [],
    lines: [],
  }),
  index: null as InkStrokeIndex | null,
  renderer: null as InkRenderer | null,
  codec: null as InkChunkCodec | null,
  /**
   * What undo replays, newest last.
   *
   * A step is an erase (restore to undo), a draw (erase to undo), or a move
   * (translate back). Indices are the buffer's, which is why `replace-page`
   * clears this: after a reorder they name different strokes.
   */
  history: [] as HistoryStep[],
  redone: [] as HistoryStep[],
  /** The lasso's current selection, as buffer indices. */
  selection: [] as number[],
  /** Buffers to hand back to the main thread's pool, batched once per frame. */
  returns: [] as ArrayBuffer[],
  /** Set while a `load-page` is in flight so two loads cannot interleave. */
  loading: false,
  /** The page's background image, kept here so a page install or a new renderer can re-apply it. */
  background: null as ImageBitmap | null,
  /** The theme's ink colours, kept so a renderer that comes up later draws in them. */
  palette: null as InkPalette | null,
};

/** The worker's own scope, typed: `self` in a module worker is not the window. */
const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(event: InkWorkerEvent, transfer: Transferable[] = []): void {
  scope.postMessage(event, transfer);
}

/**
 * Read a batch into the live stroke, keeping any predicted tail behind it.
 *
 * The arrays are grown once per batch and written by index; a per-sample push of an
 * object would be the same garbage the batched protocol exists to avoid, one thread
 * over. `realSamples` is what separates digitiser truth from prediction.
 */
function appendSamples(stroke: LiveStroke, payload: InkSamplePayload): void {
  const start = stroke.realSamples;
  const end = start + payload.count;
  stroke.points.length = end * 2;
  stroke.pressures.length = end;
  let index = 0;
  eachInkSample(payload, (x, y, pressure) => {
    stroke.points[(start + index) * 2] = x;
    stroke.points[(start + index) * 2 + 1] = y;
    stroke.pressures[start + index] = pressureByte(pressure);
    index += 1;
  });
  stroke.realSamples = end;
}

/** Replace the predicted tail: truncate to the last real sample, then append. */
function replacePredictedTail(
  stroke: LiveStroke,
  payload: InkSamplePayload,
): void {
  stroke.points.length = stroke.realSamples * 2;
  stroke.pressures.length = stroke.realSamples;
  eachInkSample(payload, (x, y, pressure) => {
    stroke.points.push(x, y);
    stroke.pressures.push(pressureByte(pressure));
  });
}

/** The pen reports 0–1; the page and the renderer hold a byte. */
function pressureByte(pressure: number): number {
  return Math.max(0, Math.min(255, Math.round(pressure * 255)));
}

/** The live stroke as the renderer takes it: typed arrays, real count included. */
function liveForRenderer(stroke: LiveStroke): InkLiveStroke {
  const count = stroke.points.length / 2;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const pressure = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    x[i] = stroke.points[i * 2]!;
    y[i] = stroke.points[i * 2 + 1]!;
    pressure[i] = stroke.pressures[i]!;
  }
  return {
    header: stroke.header,
    x,
    y,
    pressure,
    realCount: stroke.realSamples,
  };
}

/** Pack the finished stroke into the page, and tell the main thread what was kept. */
function commitStroke(stroke: LiveStroke): void {
  const real = stroke.realSamples;
  let raw: readonly number[] = stroke.points.slice(0, real * 2);
  let rawPressures: readonly number[] = stroke.pressures.slice(0, real);
  let shape: InkShape = "none";
  if (stroke.header.tool === "shape") {
    // The shape tool snaps on lift (§6.3): the mark is fitted here, once, and what
    // is stored is the fitted path with a flat pressure, so a rectangle is a
    // rectangle in the sidecar and not a rectangle-shaped scribble.
    const snapped = snapShape(raw);
    if (snapped) {
      raw = snapped.points;
      rawPressures = new Array(raw.length / 2).fill(128);
      shape = snapped.shape;
    }
  }
  if (shape === "none") {
    // A stroke is refitted on lift (§6.2.5): resampled evenly and run
    // through a non-causal kernel, which takes out the digitiser's per-sample
    // wobble the live filter cannot without lag. A snapped shape is already
    // clean. The highlighter is refitted too: its width hides the wobble, but
    // the stencil dedupe turns each wobbling join into a faint seam.
    const smoothed = smoothInkStroke(raw, rawPressures);
    raw = smoothed.points;
    rawPressures = smoothed.pressures;
  }
  const packed = packInkStroke(raw, rawPressures);
  if (packed.points.length < 4) return; // a dot or a slip of the pen: nothing to keep
  const index = state.buffer.append({
    points: packed.points,
    pressures: packed.pressures,
    width: stroke.header.width,
    tool: stroke.header.tool,
    colour: stroke.header.colour,
    shape,
  });
  state.history.push({ kind: "draw", indices: [index] });
  state.redone = [];
  reportHistory();
  // The index is stale the moment a stroke is added; rebuilding it per stroke would
  // be exactly the per-append allocation §6.2.4 forbids, so it is invalidated and
  // rebuilt lazily by the next pick.
  state.index?.invalidate();

  const geometry = state.buffer.stroke(index)!;
  state.renderer?.appendStroke(geometry, index);

  const points = new Float32Array(geometry.x.length * 2);
  const pressures = new Uint8Array(geometry.x.length);
  for (let i = 0; i < geometry.x.length; i += 1) {
    points[i * 2] = geometry.x[i]!;
    points[i * 2 + 1] = geometry.y[i]!;
    pressures[i] = geometry.pressure[i]!;
  }
  post({ type: "stroke-committed", header: stroke.header, points, pressures }, [
    points.buffer,
    pressures.buffer,
  ]);
  reportState();
}

/** Tell the main thread what the page now holds. */
function reportState(): void {
  const stats = state.renderer?.renderStats;
  post({
    type: "page-state",
    pageIndex: state.pageIndex,
    strokes: state.buffer.liveCount,
    segments: stats?.segments ?? 0,
    backend: state.renderer?.backend ?? "none",
    width: state.buffer.width,
    height: state.buffer.height,
  });
}

/** Tell the bar how deep undo and redo go. */
function reportHistory(): void {
  post({
    type: "history",
    undo: state.history.length,
    redo: state.redone.length,
  });
}

/**
 * Fit a shape to a finished mark, and answer the fitted polyline.
 *
 * `null` when the recogniser abstains, which leaves the mark as drawn — a
 * shape tool that guesses is worse than one that sometimes does nothing. An
 * arrow is its shaft and its head joined into one path, which is what one
 * stroke can hold; the head's own doubling back is what draws the barbs.
 */
function snapShape(
  points: readonly number[],
): { points: number[]; shape: InkShape } | null {
  const recognised = recogniseShape(points);
  if (!recognised.fit) return null;
  const geometry = recognised.fit.geometry;
  const paths =
    geometry.kind === "arrow"
      ? fittedArrowPaths(geometry)
      : [fittedInkPath(geometry)];
  const flat: number[] = [];
  for (const path of paths) for (const [x, y] of path) flat.push(x, y);
  return flat.length >= 4
    ? { points: flat, shape: recognised.fit.shape }
    : null;
}

/** One frame: draw, count it, hand buffers back, ask for the next. */
function tick(): void {
  if (state.disposed) return;
  state.frame += 1;
  if (state.live) state.renderer?.setLive(liveForRenderer(state.live));
  else state.renderer?.setLive(null);
  state.renderer?.draw();
  post({
    type: "frame",
    frame: state.frame,
    strokeId: state.live?.header.strokeId ?? 0,
  });
  if (state.returns.length > 0) {
    const buffers = state.returns.splice(0, state.returns.length);
    post({ type: "samples-returned", buffers }, buffers);
  }
  scope.requestAnimationFrame(tick);
}

/** The loop runs only while there is something to draw. */
function ensureLoop(): void {
  if (state.running || state.disposed) return;
  state.running = true;
  scope.requestAnimationFrame(tick);
}

/** Bring up the renderer, with the attributes this path needs. */
function startRenderer(delegating: boolean): void {
  const canvas = state.canvas;
  if (!canvas) {
    // Headless: the canvas could not be transferred, or there is none. The page
    // logic runs the same; the host paints nothing from here.
    post({ type: "ready", backend: "none" });
    return;
  }
  let renderer: InkRenderer | null = null;
  let reason = "";
  try {
    if (!supportsWebglInk(canvas)) throw new Error("WebGL2 is unavailable");
    // The shaders are compiled on a throwaway canvas first. A canvas that has
    // given out a WebGL context can never give out a 2D one, so a driver that
    // rejects the shaders has to be found before the real canvas is asked for
    // anything — otherwise the failure takes the Canvas 2D fallback with it.
    if (typeof OffscreenCanvas !== "undefined")
      new WebglInkRenderer({ canvas: new OffscreenCanvas(1, 1) }).dispose();
    renderer = new WebglInkRenderer({
      canvas,
      delegating,
      onContextLifecycle: (state_) => {
        post(
          state_ === "lost"
            ? { type: "context-lost" }
            : { type: "context-restored", backend: "webgl2" },
        );
        if (state_ === "restored") {
          // Everything is reconstructible from the page buffer, so recovery is
          // "re-upload", never "recover the user's data" (§6.2.9).
          state.renderer?.setStrokes(state.buffer.allStrokes());
        }
      },
    });
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  if (!renderer) {
    // The Canvas 2D path (§6.2.9): the same contract, drawn with paths. A canvas
    // that already gave out a WebGL context cannot give out a 2D one, but a
    // canvas that *refused* WebGL still can, which is the case this serves.
    try {
      renderer = new CanvasInkRenderer({ canvas });
    } catch (error) {
      reason += `; ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (!renderer) {
    // The pen keeps working when nothing can draw: a lost renderer is a degraded
    // note, not a lost one. Strokes still commit, still save, still recognise.
    post({ type: "ready", backend: "none" });
    post({ type: "error", message: reason });
    return;
  }
  state.renderer = renderer;
  renderer.setPage(
    { width: state.width, height: state.height },
    state.buffer.paper,
  );
  renderer.setBackground(state.background);
  if (state.palette) renderer.setPalette(state.palette);
  renderer.resize(state.width, state.height, state.dpr);
  renderer.setStrokes(state.buffer.allStrokes());
  renderer.setSelection(state.selection, { x: 0, y: 0 });
  state.index = new InkStrokeIndex(state.buffer);
  post({ type: "ready", backend: renderer.backend });
}

/** Load a page's bytes into the buffer and the renderer. */
async function loadPage(
  message: Extract<InkWorkerMessage, { type: "load-page" }>,
): Promise<void> {
  if (state.loading) return;
  state.loading = true;
  try {
    state.pageIndex = message.pageIndex;
    // The whole decode happens here, off the main thread, which is the reason the
    // protocol carries bytes rather than a parsed page.
    const model = message.chunk
      ? pageFromChunk(
          await decodeInkChunk(
            message.chunk instanceof Uint8Array
              ? message.chunk
              : new Uint8Array(message.chunk),
            state.codec ?? undefined,
          ),
        )
      : {
          width: INK_A4_WIDTH,
          height: INK_A4_HEIGHT,
          paper: "blank" as const,
          background: 0,
          strokes: [],
          lines: [],
        };
    installPage(model);
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    state.loading = false;
  }
}

/** Put a page model in place of the current one: buffer, index, renderer, history. */
function installPage(model: InkPage): void {
  state.buffer = new InkPageBuffer(model);
  // One rebuild per page load, which is where a packed tree belongs: not during a
  // gesture, and not per stroke (§6.2.4).
  state.index = new InkStrokeIndex(state.buffer);
  state.index.rebuild();
  state.history = [];
  state.redone = [];
  state.selection = [];
  state.renderer?.setPage(
    { width: model.width, height: model.height },
    model.paper,
  );
  state.renderer?.setBackground(state.background);
  state.renderer?.setStrokes(state.buffer.allStrokes());
  state.renderer?.setSelection([], { x: 0, y: 0 });
  reportState();
  reportHistory();
  post({ type: "selected", indices: [], bounds: null });
}

/** Pack the page as the sidecar stores it, and hand the bytes over. */
async function savePage(requestId: number): Promise<void> {
  const page = state.buffer.toPage();
  const strokes = page.strokes.length;
  if (strokes === 0) {
    post({
      type: "page-saved",
      requestId,
      pageIndex: state.pageIndex,
      bytes: null,
      strokes,
    });
    return;
  }
  const bytes = await encodeInkChunk(page, state.codec ?? undefined);
  post(
    {
      type: "page-saved",
      requestId,
      pageIndex: state.pageIndex,
      bytes,
      strokes,
    },
    [bytes.buffer],
  );
}

/** Take a set of strokes out, as one history step, and tell the screen. */
function eraseIndices(
  indices: readonly number[],
  kind: "erase" | "draw" = "erase",
): number[] {
  const removed: number[] = [];
  for (const index of indices) {
    if (state.buffer.erase(index)) {
      state.renderer?.removeStroke(index);
      removed.push(index);
    }
  }
  if (removed.length > 0) {
    if (kind === "erase") {
      state.history.push({ kind: "erase", indices: removed });
      state.redone = [];
    }
    state.index?.invalidate();
    post({ type: "erased", indices: removed });
    reportState();
    reportHistory();
  }
  return removed;
}

/** Bring erased strokes back, re-uploading each at its own index. */
function restoreIndices(indices: readonly number[]): void {
  for (const index of indices) {
    if (!state.buffer.restore(index)) continue;
    const geometry = state.buffer.stroke(index);
    if (geometry) state.renderer?.appendStroke(geometry, index);
  }
  state.index?.invalidate();
  reportState();
}

/** Translate strokes in place. The geometry is the buffer's own, so it is edited. */
function translateIndices(
  indices: readonly number[],
  dx: number,
  dy: number,
): void {
  for (const index of indices) {
    const geometry = state.buffer.stroke(index);
    if (!geometry) continue;
    for (let i = 0; i < geometry.x.length; i += 1) {
      geometry.x[i] = geometry.x[i]! + dx;
      geometry.y[i] = geometry.y[i]! + dy;
    }
    geometry.bounds = boundsOf(geometry.x, geometry.y);
    state.renderer?.removeStroke(index);
    state.renderer?.appendStroke(geometry, index);
  }
  state.index?.invalidate();
  reportState();
}

/**
 * Whether a point is inside a closed polygon, by the even-odd rule.
 *
 * `polygon` is flat `[x, y, …]` in page units. The lasso is a hand-drawn loop,
 * so the polygon is closed implicitly from its last point back to its first.
 */
export function pointInPolygon(
  px: number,
  py: number,
  polygon: readonly number[],
): boolean {
  const count = polygon.length / 2;
  let inside = false;
  for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
    const xi = polygon[i * 2]!;
    const yi = polygon[i * 2 + 1]!;
    const xj = polygon[j * 2]!;
    const yj = polygon[j * 2 + 1]!;
    const crosses =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Select what a lasso loop enclosed: strokes with most of their points inside. */
function lasso(polygon: readonly number[]): void {
  if (polygon.length < 6) {
    state.selection = [];
    state.renderer?.setSelection([], { x: 0, y: 0 });
    post({ type: "selected", indices: [], bounds: null });
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < polygon.length; i += 2) {
    minX = Math.min(minX, polygon[i]!);
    maxX = Math.max(maxX, polygon[i]!);
    minY = Math.min(minY, polygon[i + 1]!);
    maxY = Math.max(maxY, polygon[i + 1]!);
  }
  const index = state.index ?? new InkStrokeIndex(state.buffer);
  state.index = index;
  index.ensure();
  const box: InkBounds = [minX, minY, maxX, maxY];
  const chosen: number[] = [];
  let bounds: InkBounds | null = null;
  for (const candidate of index.nearBox(box)) {
    const geometry = state.buffer.stroke(candidate);
    if (!geometry || geometry.x.length === 0) continue;
    let inside = 0;
    for (let i = 0; i < geometry.x.length; i += 1) {
      if (pointInPolygon(geometry.x[i]!, geometry.y[i]!, polygon)) inside += 1;
    }
    if (inside * 2 < geometry.x.length) continue;
    chosen.push(candidate);
    const b = geometry.bounds;
    bounds = bounds
      ? [
          Math.min(bounds[0], b[0]),
          Math.min(bounds[1], b[1]),
          Math.max(bounds[2], b[2]),
          Math.max(bounds[3], b[3]),
        ]
      : [b[0], b[1], b[2], b[3]];
  }
  state.selection = chosen;
  state.renderer?.setSelection(chosen, { x: 0, y: 0 });
  ensureLoop();
  post({ type: "selected", indices: chosen, bounds });
}

/** Erase along a swept segment, and report what went. */
function erase(
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  const index = state.index ?? new InkStrokeIndex(state.buffer);
  state.index = index;
  index.ensure();
  const candidates = index.nearSegment(from.x, from.y, to.x, to.y);
  const removed: number[] = [];
  for (const candidate of candidates) {
    const geometry = state.buffer.stroke(candidate);
    if (!geometry) continue;
    // A bounds hit is a candidate, not a hit: the eraser matches what the user sees,
    // so the path decides. The nib's radius is the eraser's own from §6.3.
    if (!strokeNearPoint(geometry, from, to)) continue;
    removed.push(candidate);
  }
  eraseIndices(removed);
}

/**
 * Whether a stroke passes near a swept segment.
 *
 * The index returned candidates by bounding box; this is the exact test, and it is
 * the *only* place a pick decides anything. It is deliberately the same shape as the
 * reader's `inkPathsHitTest` — distance from the point to each segment — because the
 * two features must agree about what "under the eraser" means.
 */
function strokeNearPoint(
  stroke: { x: Float32Array; y: Float32Array },
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius = 30,
): boolean {
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / radius),
  );
  const r2 = radius * radius;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const px = from.x + (to.x - from.x) * t;
    const py = from.y + (to.y - from.y) * t;
    // Distance to each *segment*, not each vertex: a packed stroke keeps only the
    // points that bend, so a straight line is two vertices a page apart.
    if (stroke.x.length === 1) {
      const dx = stroke.x[0]! - px;
      const dy = stroke.y[0]! - py;
      if (dx * dx + dy * dy <= r2) return true;
      continue;
    }
    for (let i = 0; i + 1 < stroke.x.length; i += 1) {
      if (
        distanceToSegmentSquared(
          px,
          py,
          stroke.x[i]!,
          stroke.y[i]!,
          stroke.x[i + 1]!,
          stroke.y[i + 1]!,
        ) <= r2
      ) {
        return true;
      }
    }
  }
  return false;
}

function distanceToSegmentSquared(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const length2 = vx * vx + vy * vy;
  const t =
    length2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / length2));
  const dx = ax + vx * t - px;
  const dy = ay + vy * t - py;
  return dx * dx + dy * dy;
}

scope.addEventListener("message", (event: MessageEvent<InkWorkerMessage>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case "init": {
        state.canvas = message.canvas;
        state.width = message.width;
        state.height = message.height;
        state.dpr = message.dpr;
        state.mode = message.mode;
        state.codec = inkChunkCodec(message.codec);
        // The path decides the context attributes, and they are immutable after the
        // first `getContext` (§6.2.8) — so this is decided once, by whether the
        // presenter is delegating, and a presenter that appears later means a new
        // canvas rather than a changed attribute.
        startRenderer(message.delegating ?? false);
        ensureLoop();
        break;
      }
      case "load-page":
        void loadPage(message);
        break;
      case "stroke-begin": {
        state.live = {
          header: message.header,
          points: [],
          pressures: [],
          realSamples: 0,
        };
        appendSamples(state.live, message.sample);
        ensureLoop();
        break;
      }
      case "samples": {
        if (
          !state.live ||
          state.live.header.strokeId !== message.header.strokeId
        )
          break;
        if (message.predicted) replacePredictedTail(state.live, message.sample);
        else appendSamples(state.live, message.sample);
        break;
      }
      case "stroke-end": {
        const live = state.live;
        if (!live || live.header.strokeId !== message.header.strokeId) break;
        appendSamples(live, message.sample);
        commitStroke(live);
        state.live = null;
        state.renderer?.setLive(null);
        break;
      }
      case "erase":
        erase(message.from, message.to);
        break;
      case "undo": {
        const step = state.history.pop();
        if (!step) break;
        if (step.kind === "erase") restoreIndices(step.indices);
        else if (step.kind === "draw") eraseIndices(step.indices, "draw");
        else translateIndices(step.indices, -step.dx, -step.dy);
        state.redone.push(step);
        reportHistory();
        break;
      }
      case "redo": {
        const step = state.redone.pop();
        if (!step) break;
        if (step.kind === "erase") eraseIndices(step.indices, "draw");
        else if (step.kind === "draw") restoreIndices(step.indices);
        else translateIndices(step.indices, step.dx, step.dy);
        state.history.push(step);
        reportHistory();
        break;
      }
      case "save-page":
        void savePage(message.requestId).catch((error: unknown) =>
          post({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        break;
      case "page-model":
        post({
          type: "page-model",
          requestId: message.requestId,
          pageIndex: state.pageIndex,
          page: state.buffer.toPage(),
        });
        break;
      case "replace-page":
        installPage(message.page);
        break;
      case "lasso":
        lasso(message.polygon);
        break;
      case "select-clear":
        state.selection = [];
        state.renderer?.setSelection([], { x: 0, y: 0 });
        post({ type: "selected", indices: [], bounds: null });
        ensureLoop();
        break;
      case "delete-selection": {
        const indices = state.selection;
        state.selection = [];
        state.renderer?.setSelection([], { x: 0, y: 0 });
        eraseIndices(indices);
        post({ type: "selected", indices: [], bounds: null });
        break;
      }
      case "drag-selection": {
        if (state.selection.length === 0) break;
        state.renderer?.setSelection(state.selection, {
          x: message.dx,
          y: message.dy,
        });
        ensureLoop();
        break;
      }
      case "move-selection": {
        // The drag preview ends with the move, whether or not it went anywhere.
        state.renderer?.setSelection(state.selection, { x: 0, y: 0 });
        ensureLoop();
        if (
          state.selection.length === 0 ||
          (message.dx === 0 && message.dy === 0)
        )
          break;
        translateIndices(state.selection, message.dx, message.dy);
        state.history.push({
          kind: "move",
          indices: [...state.selection],
          dx: message.dx,
          dy: message.dy,
        });
        state.redone = [];
        reportHistory();
        break;
      }
      case "palette": {
        state.palette = message.colours;
        state.renderer?.setPalette(message.colours);
        break;
      }
      case "set-background": {
        state.background?.close?.();
        state.background = message.image;
        state.renderer?.setBackground(message.image);
        // The image is the *rendering* of §4.8; the buffer carries the
        // attachment index the chunk header mirrors, so a later save — a
        // stroke drawn over the image, say — writes it back rather than
        // clearing it.
        if (typeof message.index === "number") {
          state.buffer.setBackgroundIndex(message.index);
        }
        break;
      }
      case "export-page": {
        const renderer = state.renderer;
        // A worker with no renderer still has to answer: the host is holding a
        // promise on this request id, and silence would hang the print and PNG
        // buttons for the rest of the session rather than reporting that there
        // is nothing to draw with.
        if (!renderer) {
          post({ type: "exported", requestId: message.requestId, png: null });
          break;
        }
        void renderer
          .capture(message.scale)
          .then((png) =>
            post({ type: "exported", requestId: message.requestId, png }),
          )
          .catch((error: unknown) => {
            // Said out loud rather than swallowed: a null PNG with no reason is
            // a button that does nothing.
            console.error(
              `ink: the export failed — ${error instanceof Error ? error.message : String(error)}`,
            );
            post({ type: "exported", requestId: message.requestId, png: null });
          });
        break;
      }
      case "resize": {
        state.width = message.width;
        state.height = message.height;
        state.dpr = message.dpr;
        state.renderer?.resize(message.width, message.height, message.dpr);
        break;
      }
      case "viewport": {
        state.renderer?.setTransform(message.transform);
        break;
      }
      case "samples-returned":
        break;
      case "dispose": {
        state.disposed = true;
        state.live = null;
        state.returns.length = 0;
        state.renderer?.dispose();
        state.renderer = null;
        scope.close();
        break;
      }
    }
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // Buffers that were transferred belong to the worker until it hands them back.
    // Doing it here rather than per message keeps the return batched, which is the
    // same reason the samples are batched on the way in.
    if (state.mode === "transfer" && "sample" in message) {
      // `Transferable` is an `ArrayBuffer`; the only other thing this can be is a
      // `SharedArrayBuffer`, which needs COOP/COEP headers this app does not send.
      const buffer = message.sample.buffer.buffer as ArrayBuffer;
      if (buffer.byteLength > 0) state.returns.push(buffer);
    }
  }
});
