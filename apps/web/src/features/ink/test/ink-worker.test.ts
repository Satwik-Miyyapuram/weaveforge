/**
 * The worker, driven headless: no canvas, so the renderer backend is "none",
 * and what is under test is the page logic — commit, erase, undo across the
 * three step kinds, lasso, and the save round-trip through the sidecar codec.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";

import { decodeInkChunk, pageFromChunk } from "@weaveforge/core";

import type { InkStrokeHeader, InkWorkerEvent, InkWorkerMessage } from "../application/capture-protocol";
import { INK_SAMPLE_STRIDE } from "../application/capture-protocol";

type Listener = (event: { data: InkWorkerMessage }) => void;

const posted: InkWorkerEvent[] = [];
let listener: Listener | null = null;
let pointInPolygon: (px: number, py: number, polygon: readonly number[]) => boolean;

before(async () => {
  (globalThis as { self?: unknown }).self = {
    postMessage: (event: InkWorkerEvent) => posted.push(event),
    addEventListener: (_type: string, fn: Listener) => {
      listener = fn;
    },
    // The loop is a no-op here: nothing draws, and a frame never has to arrive.
    requestAnimationFrame: () => 0,
  };
  const worker = await import("../worker/ink-worker");
  pointInPolygon = worker.pointInPolygon;
});

function send(message: InkWorkerMessage): void {
  assert.ok(listener, "the worker registered its listener");
  listener({ data: message });
}

function events<T extends InkWorkerEvent["type"]>(type: T): Extract<InkWorkerEvent, { type: T }>[] {
  return posted.filter((event) => event.type === type) as Extract<InkWorkerEvent, { type: T }>[];
}

function last<T extends InkWorkerEvent["type"]>(type: T): Extract<InkWorkerEvent, { type: T }> {
  const all = events(type);
  assert.ok(all.length > 0, `a ${type} event was posted`);
  return all[all.length - 1]!;
}

/** Wait for the worker's async work (save, load) to settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let strokeId = 0;
const header = (tool: InkStrokeHeader["tool"] = "pen"): InkStrokeHeader => ({
  strokeId,
  pageIndex: 0,
  tool,
  width: 6,
  colour: "text",
});

/** Send one whole stroke in a single batch. */
function stroke(samples: Float32Array, count: number, tool: InkStrokeHeader["tool"] = "pen"): void {
  strokeId += 1;
  const h = header(tool);
  const empty = { buffer: new Float32Array(0), count: 0 };
  send({ type: "stroke-begin", header: h, sample: { buffer: samples, count } });
  send({ type: "stroke-end", header: h, sample: empty });
}

/** Draw one stroke as a straight line from (x0, y) rightwards. */
function draw(x0: number, y: number, count = 6, tool: InkStrokeHeader["tool"] = "pen"): void {
  const samples = new Float32Array(count * INK_SAMPLE_STRIDE);
  for (let i = 0; i < count; i += 1) {
    samples[i * INK_SAMPLE_STRIDE] = x0 + i * 30;
    samples[i * INK_SAMPLE_STRIDE + 1] = y;
    samples[i * INK_SAMPLE_STRIDE + 2] = 0.5;
    samples[i * INK_SAMPLE_STRIDE + 3] = i;
  }
  stroke(samples, count, tool);
}

function fresh(): void {
  posted.length = 0;
  send({ type: "init", canvas: null, width: 400, height: 600, dpr: 1, mode: "clone", codec: "identity" });
  send({ type: "load-page", pageIndex: 0, chunk: null });
}

test("a stroke commits, is a draw step, and undo takes it back", () => {
  fresh();
  assert.equal(last("ready").backend, "none");
  draw(10, 50);
  assert.equal(last("page-state").strokes, 1);
  assert.deepEqual(last("history"), { type: "history", undo: 1, redo: 0 });
  send({ type: "undo" });
  assert.equal(last("page-state").strokes, 0);
  assert.deepEqual(last("history"), { type: "history", undo: 0, redo: 1 });
  send({ type: "redo" });
  assert.equal(last("page-state").strokes, 1);
});

test("an erase sweep removes what it crosses and undo restores it", () => {
  fresh();
  draw(10, 50);
  draw(10, 300);
  send({ type: "erase", from: { x: 70, y: 20 }, to: { x: 70, y: 80 } });
  const erased = last("erased");
  assert.deepEqual(erased.indices, [0]);
  assert.equal(last("page-state").strokes, 1);
  send({ type: "undo" });
  assert.equal(last("page-state").strokes, 2);
});

test("a lasso selects strokes mostly inside its loop, and the selection moves and deletes", () => {
  fresh();
  draw(10, 50);
  draw(10, 300);
  send({ type: "lasso", polygon: [0, 0, 400, 0, 400, 100, 0, 100] });
  const selected = last("selected");
  assert.deepEqual(selected.indices, [0]);
  assert.ok(selected.bounds);
  send({ type: "move-selection", dx: 0, dy: 400 });
  assert.equal(last("history").undo, 3);
  send({ type: "lasso", polygon: [0, 400, 400, 400, 400, 500, 0, 500] });
  assert.deepEqual(last("selected").indices, [0], "the moved stroke is found at its new place");
  send({ type: "delete-selection" });
  assert.equal(last("page-state").strokes, 1);
  send({ type: "undo" });
  assert.equal(last("page-state").strokes, 2);
  send({ type: "undo" }); // the move
  send({ type: "lasso", polygon: [0, 0, 400, 0, 400, 100, 0, 100] });
  assert.deepEqual(last("selected").indices, [0], "undoing the move puts it back");
});

test("save-page packs the page and load-page brings it back", async () => {
  fresh();
  draw(10, 50);
  draw(10, 120, 4, "highlighter");
  send({ type: "save-page", requestId: 7 });
  await settle();
  const saved = last("page-saved");
  assert.equal(saved.requestId, 7);
  assert.equal(saved.strokes, 2);
  assert.ok(saved.bytes);
  const page = pageFromChunk(await decodeInkChunk(saved.bytes));
  assert.equal(page.strokes.length, 2);
  assert.equal(page.strokes[1]!.tool, "highlighter");

  send({ type: "load-page", pageIndex: 1, chunk: saved.bytes });
  await settle();
  const state = last("page-state");
  assert.equal(state.pageIndex, 1);
  assert.equal(state.strokes, 2);
  assert.deepEqual(last("history"), { type: "history", undo: 0, redo: 0 });
});

test("an empty page saves as no bytes", async () => {
  fresh();
  send({ type: "save-page", requestId: 1 });
  await settle();
  assert.equal(last("page-saved").bytes, null);
});

test("replace-page swaps the model and page-model answers with the current one", () => {
  fresh();
  draw(10, 50);
  send({ type: "page-model", requestId: 3 });
  const model = last("page-model");
  assert.equal(model.page.strokes.length, 1);
  send({ type: "replace-page", page: { ...model.page, strokes: [] } });
  assert.equal(last("page-state").strokes, 0);
});

test("the shape tool snaps a rectangle-ish scribble to a rectangle", () => {
  fresh();
  const corners = [
    [20, 20],
    [220, 22],
    [222, 120],
    [18, 118],
    [20, 24],
  ];
  const points: number[] = [];
  for (let i = 0; i + 1 < corners.length; i += 1) {
    const [ax, ay] = corners[i]!;
    const [bx, by] = corners[i + 1]!;
    for (let t = 0; t < 1; t += 0.1) points.push(ax! + (bx! - ax!) * t, ay! + (by! - ay!) * t);
  }
  const count = points.length / 2;
  const samples = new Float32Array(count * INK_SAMPLE_STRIDE);
  for (let i = 0; i < count; i += 1) {
    samples[i * INK_SAMPLE_STRIDE] = points[i * 2]!;
    samples[i * INK_SAMPLE_STRIDE + 1] = points[i * 2 + 1]!;
    samples[i * INK_SAMPLE_STRIDE + 2] = 0.5;
    samples[i * INK_SAMPLE_STRIDE + 3] = i;
  }
  stroke(samples, count, "shape");
  send({ type: "page-model", requestId: 1 });
  const fitted = last("page-model").page.strokes[0]!;
  assert.equal(fitted.shape, "rect");
  assert.ok(fitted.points.length <= 12, "the fitted rectangle is corners, not the scribble");
});

test("pointInPolygon follows the even-odd rule", () => {
  const square = [0, 0, 10, 0, 10, 10, 0, 10];
  assert.equal(pointInPolygon(5, 5, square), true);
  assert.equal(pointInPolygon(15, 5, square), false);
  assert.equal(pointInPolygon(5, -1, square), false);
});
