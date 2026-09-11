/// <reference lib="webworker" />

/**
 * The ink worker: it owns the page's geometry and the pen's render loop.
 *
 * Why the worker is not optional (§6.2.2): this app's main thread runs React,
 * CodeMirror, Yjs, file indexing and wiki lint, and measured tasks there reach
 * **16–74 ms** — one keystroke is 2–9 dropped frames at 120 Hz. Whatever draws
 * ink must not be in that queue.
 *
 * What it does today, in step 2 of the plan:
 *
 * - takes ownership of the canvas through `transferControlToOffscreen`;
 * - accumulates the live stroke from the sample batches, replacing the predicted
 *   tail rather than committing it;
 * - **packs a finished stroke** with core's pressure-aware `packInkStroke` — the
 *   same function the note's sidecar uses, so what is drawn and what is stored
 *   cannot drift;
 * - answers every frame with a one-byte progress counter, which is what the
 *   delegated trail reads to decide whether it is rendering ahead of the worker
 *   (§6.2.6);
 * - hands sample buffers back to the main thread's pool, once per frame.
 *
 * What it does **not** do yet: draw. The render surface arrives in step 4
 * (`features/ink/render/`), and the WebGL2 context is deliberately not created
 * here — a canvas has one context type, and taking a 2D context now would make
 * the WebGL2 one impossible later without replacing the canvas.
 */

import { INK_A4_HEIGHT, INK_A4_WIDTH, packInkStroke } from "@weaveforge/core";

import {
  eachInkSample,
  type InkSamplePayload,
  type InkStrokeHeader,
  type InkTransferMode,
  type InkWorkerEvent,
  type InkWorkerMessage,
} from "../application/capture-protocol";

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

/** Everything the worker knows, as fields — it is not a class and needs no React. */
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
  committed: [] as CommittedStroke[],
  /** Buffers to hand back to the main thread's pool, batched once per frame. */
  returns: [] as ArrayBuffer[],
};

/** The worker's own scope, typed: `self` in a module worker is not the window. */
const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(event: InkWorkerEvent, transfer: Transferable[] = []): void {
  scope.postMessage(event, transfer);
}

/**
 * Read a batch into the live stroke, keeping any predicted tail behind it.
 *
 * The arrays are grown once per batch and written by index; a per-sample push of
 * an object would be the same garbage the batched protocol exists to avoid, one
 * thread over. `realSamples` is what separates digitiser truth from prediction.
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

/** Pack the finished stroke and tell the main thread what was stored. */
function commitStroke(stroke: LiveStroke): void {
  const real = stroke.realSamples;
  const packed = packInkStroke(
    stroke.points.slice(0, real * 2),
    stroke.pressures.slice(0, real),
  );
  if (packed.points.length < 4) return; // a dot or a slip of the pen: nothing to keep
  const committed: CommittedStroke = {
    header: stroke.header,
    points: Float32Array.from(packed.points),
    pressures: Float32Array.from(packed.pressures),
  };
  state.committed.push(committed);
  // The arrays are transferred, not copied: the main thread only reads them, and
  // they can be large for a long stroke.
  post(
    {
      type: "stroke-committed",
      header: committed.header,
      points: committed.points,
      pressures: committed.pressures,
    },
    [committed.points.buffer, committed.pressures.buffer],
  );
}

/** One frame: count it, hand buffers back, ask for the next. */
function tick(): void {
  if (state.disposed) return;
  state.frame += 1;
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
        // The backend is reported now and will become "webgl2" when the render
        // surface arrives; "none" means the pen still captures, it just cannot
        // paint here yet.
        post({ type: "ready", backend: "none" });
        ensureLoop();
        break;
      }
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
        break;
      }
      case "samples-returned": {
        // The main thread has pooled these; nothing for the worker to hold.
        break;
      }
      case "viewport": {
        // The transform arrives in step 4, with the renderer that reads it.
        break;
      }
      case "dispose": {
        state.disposed = true;
        state.live = null;
        state.committed = [];
        state.returns.length = 0;
        scope.close();
        break;
      }
    }
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    // Buffers that were transferred belong to the worker until it hands them
    // back. Doing it here rather than per message keeps the return batched, which
    // is the same reason the samples are batched on the way in.
    if (state.mode === "transfer" && "sample" in message) {
      // `Transferable` is an `ArrayBuffer`; the only other thing this can be is a
      // `SharedArrayBuffer`, which needs COOP/COEP headers this app does not send.
      const buffer = message.sample.buffer.buffer as ArrayBuffer;
      if (buffer.byteLength > 0) state.returns.push(buffer);
    }
  }
});
