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
  packInkStroke,
  pageFromChunk,
  type InkChunkCodec,
} from "@weaveforge/core";

import {
  eachInkSample,
  type InkSamplePayload,
  type InkStrokeHeader,
  type InkTransferMode,
  type InkWorkerEvent,
  type InkWorkerMessage,
} from "../application/capture-protocol";
import { InkPageBuffer } from "../application/page-buffer";
import { InkStrokeIndex } from "../application/stroke-index";
import {
  WebglInkRenderer,
  supportsWebglInk,
} from "../render/webgl-renderer";
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
  /** Erased stroke indices, newest last: what undo replays in reverse. */
  history: [] as number[][],
  redone: [] as number[][],
  /** Buffers to hand back to the main thread's pool, batched once per frame. */
  returns: [] as ArrayBuffer[],
  /** Set while a `load-page` is in flight so two loads cannot interleave. */
  loading: false,
};

/** The worker's own scope, typed: `self` in a module worker is not the window. */
const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(event: InkWorkerEvent, transfer: Transferable[] = []): void {
  scope.postMessage(event, transfer);
}

/**
 * The codec a chunk is decoded with.
 *
 * `deflate-raw` through `CompressionStream`, which every Chromium and Firefox has
 * and Safari 16.4+ does; brotli is **not** reachable from the web at all
 * (`CompressionStream` does not expose it, §4.3), which is why the desktop build
 * passes its own. `identity` is for a page small enough to have been stored raw.
 *
 * Absent `CompressionStream` the worker falls back to identity, which decodes an
 * uncompressed chunk correctly and refuses a compressed one with the container's
 * own error rather than silently producing nothing.
 */
function makeCodec(name: "identity" | "deflate-raw" | undefined): InkChunkCodec | null {
  if (name !== "deflate-raw") return null;
  if (typeof CompressionStream !== "function" || typeof DecompressionStream !== "function") return null;
  return {
    id: "deflate-raw",
    compress: async (bytes) => pipeThrough(new CompressionStream("deflate-raw"), bytes),
    decompress: async (bytes) => pipeThrough(new DecompressionStream("deflate-raw"), bytes),
  };
}

/** Push bytes through a transform stream and collect what comes out. */
async function pipeThrough(stream: GenericTransformStream, bytes: Uint8Array): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value as Uint8Array);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
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
    stroke.pressures[start + index] = pressure;
    index += 1;
  });
  stroke.realSamples = end;
}

/** Replace the predicted tail: truncate to the last real sample, then append. */
function replacePredictedTail(stroke: LiveStroke, payload: InkSamplePayload): void {
  stroke.points.length = stroke.realSamples * 2;
  stroke.pressures.length = stroke.realSamples;
  eachInkSample(payload, (x, y, pressure) => {
    stroke.points.push(x, y);
    stroke.pressures.push(pressure);
  });
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
  return { header: stroke.header, x, y, pressure, realCount: stroke.realSamples };
}

/** Pack the finished stroke into the page, and tell the main thread what was kept. */
function commitStroke(stroke: LiveStroke): void {
  const real = stroke.realSamples;
  const packed = packInkStroke(stroke.points.slice(0, real * 2), stroke.pressures.slice(0, real));
  if (packed.points.length < 4) return; // a dot or a slip of the pen: nothing to keep
  const index = state.buffer.append({
    points: packed.points,
    pressures: packed.pressures,
    width: stroke.header.width,
    tool: stroke.header.tool,
    colour: stroke.header.colour,
  });
  // The index is stale the moment a stroke is added; rebuilding it per stroke would
  // be exactly the per-append allocation §6.2.4 forbids, so it is invalidated and
  // rebuilt lazily by the next pick.
  state.index?.invalidate();

  const geometry = state.buffer.stroke(index)!;
  state.renderer?.appendStroke(geometry);

  const points = new Float32Array(geometry.x.length * 2);
  const pressures = new Uint8Array(geometry.x.length);
  for (let i = 0; i < geometry.x.length; i += 1) {
    points[i * 2] = geometry.x[i]!;
    points[i * 2 + 1] = geometry.y[i]!;
    pressures[i] = geometry.pressure[i]!;
  }
  post(
    { type: "stroke-committed", header: stroke.header, points, pressures },
    [points.buffer, pressures.buffer],
  );
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
  });
}

/** One frame: draw, count it, hand buffers back, ask for the next. */
function tick(): void {
  if (state.disposed) return;
  state.frame += 1;
  if (state.live) state.renderer?.setLive(liveForRenderer(state.live));
  else state.renderer?.setLive(null);
  state.renderer?.draw();
  post({ type: "frame", frame: state.frame, strokeId: state.live?.header.strokeId ?? 0 });
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
  if (!canvas) return;
  try {
    if (!supportsWebglInk(canvas)) throw new Error("WebGL2 is unavailable");
    state.renderer = new WebglInkRenderer({
      canvas,
      delegating,
      onContextLifecycle: (state_) => {
        post(state_ === "lost" ? { type: "context-lost" } : { type: "context-restored", backend: "webgl2" });
        if (state_ === "restored") {
          // Everything is reconstructible from the page buffer, so recovery is
          // "re-upload", never "recover the user's data" (§6.2.9).
          state.renderer?.setStrokes(state.buffer.liveStrokes());
        }
      },
    });
    state.renderer.setPage({ width: state.width, height: state.height }, state.buffer.paper);
    state.renderer.resize(state.width, state.height, state.dpr);
    state.renderer.setStrokes(state.buffer.liveStrokes());
    state.index = new InkStrokeIndex(state.buffer);
    post({ type: "ready", backend: state.renderer.backend });
  } catch (error) {
    // The pen keeps working when the renderer cannot start: a lost renderer is a
    // degraded note, not a lost one. The host falls back to the Canvas 2D path.
    post({ type: "ready", backend: "none" });
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

/** Load a page's bytes into the buffer and the renderer. */
async function loadPage(message: Extract<InkWorkerMessage, { type: "load-page" }>): Promise<void> {
  if (state.loading) return;
  state.loading = true;
  try {
    state.pageIndex = message.pageIndex;
    // The whole decode happens here, off the main thread, which is the reason the
    // protocol carries bytes rather than a parsed page.
    const model = message.chunk
      ? pageFromChunk(
          await decodeInkChunk(
            message.chunk instanceof Uint8Array ? message.chunk : new Uint8Array(message.chunk),
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
    state.buffer = new InkPageBuffer(model);
    // One rebuild per page load, which is where a packed tree belongs: not during a
    // gesture, and not per stroke (§6.2.4).
    state.index = new InkStrokeIndex(state.buffer);
    state.index.rebuild();
    state.history = [];
    state.redone = [];
    state.renderer?.setPage({ width: model.width, height: model.height }, model.paper);
    state.renderer?.setStrokes(state.buffer.liveStrokes());
    reportState();
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    state.loading = false;
  }
}

/** Erase along a swept segment, and report what went. */
function erase(from: { x: number; y: number }, to: { x: number; y: number }): void {
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
    if (state.buffer.erase(candidate)) {
      state.renderer?.removeStroke(candidate);
      removed.push(candidate);
    }
  }
  if (removed.length > 0) {
    state.history.push(removed);
    state.redone = [];
    index.rebuild();
    post({ type: "erased", indices: removed });
    reportState();
  }
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
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / radius));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const px = from.x + (to.x - from.x) * t;
    const py = from.y + (to.y - from.y) * t;
    for (let i = 0; i < stroke.x.length; i += 1) {
      const dx = stroke.x[i]! - px;
      const dy = stroke.y[i]! - py;
      if (dx * dx + dy * dy <= radius * radius) return true;
    }
  }
  return false;
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
        state.codec = makeCodec(message.codec);
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
        state.live = { header: message.header, points: [], pressures: [], realSamples: 0 };
        appendSamples(state.live, message.sample);
        ensureLoop();
        break;
      }
      case "samples": {
        if (!state.live || state.live.header.strokeId !== message.header.strokeId) break;
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
        const batch = state.history.pop();
        if (!batch) break;
        for (const index of batch) {
          state.buffer.restore(index);
          const geometry = state.buffer.stroke(index);
          if (geometry) state.renderer?.appendStroke(geometry);
        }
        state.redone.push(batch);
        state.index?.invalidate();
        reportState();
        break;
      }
      case "redo": {
        const batch = state.redone.pop();
        if (!batch) break;
        for (const index of batch) {
          state.buffer.erase(index);
          state.renderer?.removeStroke(index);
        }
        state.history.push(batch);
        state.index?.invalidate();
        reportState();
        break;
      }
      case "export-page": {
        void state.renderer
          ?.capture(message.scale)
          .then((png) => post({ type: "exported", requestId: message.requestId, png }))
          .catch(() => post({ type: "exported", requestId: message.requestId, png: null }));
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
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
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
