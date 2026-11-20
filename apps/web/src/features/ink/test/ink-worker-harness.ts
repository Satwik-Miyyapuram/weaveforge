/**
 * The ink worker, driven headless for tests: `self` is faked so the worker's
 * posts are recorded and its frames are queued, not run. Call `loadInkWorker`
 * from a `before` hook, then drive the worker with `send` and read what it
 * posted with `events` and `last`.
 */
import assert from "node:assert/strict";

import type {
  InkStrokeHeader,
  InkWorkerEvent,
  InkWorkerMessage,
} from "../application/capture-protocol";
import { INK_SAMPLE_STRIDE } from "../application/capture-protocol";

type Listener = (event: { data: InkWorkerMessage }) => void;
type InkWorkerModule = typeof import("../worker/ink-worker");

export const posted: InkWorkerEvent[] = [];
export const frames: (() => void)[] = [];

/** Run queued frames, and the frames they ask for, up to `limit` rounds. */
export function runFrames(limit = 10): void {
  for (let round = 0; round < limit && frames.length > 0; round += 1) {
    for (const frame of frames.splice(0, frames.length)) frame();
  }
}
let listener: Listener | null = null;
export let liveForRenderer: InkWorkerModule["liveForRenderer"];
export let newLiveStroke: InkWorkerModule["newLiveStroke"];
export let appendSamples: InkWorkerModule["appendSamples"];
export let replacePredictedTail: InkWorkerModule["replacePredictedTail"];
export let takeRawOverflow: InkWorkerModule["takeRawOverflow"];
export let worker: InkWorkerModule;

export async function loadInkWorker(): Promise<void> {
  (globalThis as { self?: unknown }).self = {
    postMessage: (event: InkWorkerEvent) => posted.push(event),
    addEventListener: (_type: string, fn: Listener) => {
      listener = fn;
    },
    // Frames are queued, not run: a test runs them with `runFrames`.
    requestAnimationFrame: (cb: () => void) => frames.push(cb),
  };
  worker = await import("../worker/ink-worker");
  liveForRenderer = worker.liveForRenderer;
  newLiveStroke = worker.newLiveStroke;
  appendSamples = worker.appendSamples;
  replacePredictedTail = worker.replacePredictedTail;
  takeRawOverflow = worker.takeRawOverflow;
}

export function send(message: InkWorkerMessage): void {
  assert.ok(listener, "the worker registered its listener");
  listener({ data: message });
}

export function events<T extends InkWorkerEvent["type"]>(
  type: T,
): Extract<InkWorkerEvent, { type: T }>[] {
  return posted.filter((event) => event.type === type) as Extract<
    InkWorkerEvent,
    { type: T }
  >[];
}

export function last<T extends InkWorkerEvent["type"]>(
  type: T,
): Extract<InkWorkerEvent, { type: T }> {
  const all = events(type);
  assert.ok(all.length > 0, `a ${type} event was posted`);
  return all[all.length - 1]!;
}

/** Wait for the worker's async work (save, load) to settle. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let strokeId = 0;
export const header = (tool: InkStrokeHeader["tool"] = "pen"): InkStrokeHeader => ({
  strokeId,
  pageIndex: 0,
  tool,
  width: 6,
  colour: "text",
});

/** The header of a new stroke. */
export function nextHeader(tool: InkStrokeHeader["tool"] = "pen"): InkStrokeHeader {
  strokeId += 1;
  return header(tool);
}

/** Send one whole stroke in a single batch. */
export function stroke(
  samples: Float32Array,
  count: number,
  tool: InkStrokeHeader["tool"] = "pen",
): void {
  const h = nextHeader(tool);
  const empty = { buffer: new Float32Array(0), count: 0 };
  send({ type: "stroke-begin", header: h, sample: { buffer: samples, count } });
  send({ type: "stroke-end", header: h, sample: empty });
}

/** Draw one stroke as a straight line from (x0, y) rightwards. */
export function draw(
  x0: number,
  y: number,
  count = 6,
  tool: InkStrokeHeader["tool"] = "pen",
): void {
  const samples = new Float32Array(count * INK_SAMPLE_STRIDE);
  for (let i = 0; i < count; i += 1) {
    samples[i * INK_SAMPLE_STRIDE] = x0 + i * 30;
    samples[i * INK_SAMPLE_STRIDE + 1] = y;
    samples[i * INK_SAMPLE_STRIDE + 2] = 0.5;
    samples[i * INK_SAMPLE_STRIDE + 3] = i;
  }
  stroke(samples, count, tool);
}

/** Put the pen down for a new 3-sample stroke and leave it down. */
export function penDown(): InkStrokeHeader {
  const h = nextHeader();
  const samples = new Float32Array(3 * INK_SAMPLE_STRIDE);
  for (let i = 0; i < 3; i += 1) {
    samples[i * INK_SAMPLE_STRIDE] = 10 + i * 30;
    samples[i * INK_SAMPLE_STRIDE + 1] = 50;
    samples[i * INK_SAMPLE_STRIDE + 2] = 0.5;
    samples[i * INK_SAMPLE_STRIDE + 3] = i;
  }
  send({ type: "stroke-begin", header: h, sample: { buffer: samples, count: 3 } });
  return h;
}

/** Lift the pen: end the stroke with no further samples. */
export function penUp(h: InkStrokeHeader): void {
  send({ type: "stroke-end", header: h, sample: { buffer: new Float32Array(0), count: 0 } });
}

type InkCodec = Extract<InkWorkerMessage, { type: "init" }>["codec"];

/** A fresh, empty page 0 on a 400 x 600 sheet. */
export function fresh(codec: InkCodec = "identity"): void {
  posted.length = 0;
  send({
    type: "init",
    canvas: null,
    width: 400,
    height: 600,
    dpr: 1,
    mode: "clone",
    codec,
  });
  send({ type: "load-page", pageIndex: 0, chunk: null });
}
