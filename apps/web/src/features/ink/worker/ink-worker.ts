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
  packInkStroke,
  type InkChunkCodec,
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
import { InkPageBuffer } from "../application/page-buffer";
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
import {
  clearSelection,
  deleteSelection,
  dragSelection,
  erase,
  installPage,
  lasso,
  loadPage,
  moveSelection,
  pointInPolygon,
  redo,
  reportHistory,
  reportState,
  savePage,
  undo,
  type HistoryStep,
} from "./ink-page-logic";
import { exportPage } from "./ink-export";
import { setBackground } from "./ink-background";

export { pointInPolygon };

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
  reportHistory(state, post);
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
  reportState(state, post);
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
        void loadPage(state, message, post);
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
        erase(state, message.from, message.to, post);
        break;
      case "undo":
        undo(state, post);
        break;
      case "redo":
        redo(state, post);
        break;
      case "save-page":
        void savePage(state, message.requestId, post).catch((error: unknown) =>
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
        installPage(state, message.page, post);
        break;
      case "lasso":
        lasso(state, message.polygon, post, ensureLoop);
        break;
      case "select-clear":
        clearSelection(state, post, ensureLoop);
        break;
      case "delete-selection":
        deleteSelection(state, post);
        break;
      case "drag-selection":
        dragSelection(state, message.dx, message.dy, ensureLoop);
        break;
      case "move-selection":
        moveSelection(state, message.dx, message.dy, post, ensureLoop);
        break;
      case "palette": {
        state.palette = message.colours;
        state.renderer?.setPalette(message.colours);
        break;
      }
      case "set-background":
        setBackground(state, message.image, message.index);
        break;
      case "export-page":
        void exportPage(
          state.renderer,
          message.requestId,
          message.scale,
          message.transparent === true,
          post,
        );
        break;
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
