/**
 * The worker, driven headless: no canvas, so the renderer backend is "none",
 * and what is under test is the page logic — commit, erase, undo across the
 * three step kinds, lasso, and the save round-trip through the sidecar codec.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";

import {
  decodeInkChunk,
  INK_PACK_TOLERANCE,
  makeInkStroke,
  packInkStroke,
  pageFromChunk,
} from "@weaveforge/core";

import type {
  InkStrokeHeader,
  InkWorkerEvent,
  InkWorkerMessage,
} from "../application/capture-protocol";
import { INK_SAMPLE_STRIDE } from "../application/capture-protocol";

type Listener = (event: { data: InkWorkerMessage }) => void;

const posted: InkWorkerEvent[] = [];
const frames: (() => void)[] = [];

/** Run queued frames, and the frames they ask for, up to `limit` rounds. */
function runFrames(limit = 10): void {
  for (let round = 0; round < limit && frames.length > 0; round += 1) {
    for (const frame of frames.splice(0, frames.length)) frame();
  }
}
let listener: Listener | null = null;
let pointInPolygon: (
  px: number,
  py: number,
  polygon: readonly number[],
) => boolean;
let liveForRenderer: typeof import("../worker/ink-worker").liveForRenderer;

before(async () => {
  (globalThis as { self?: unknown }).self = {
    postMessage: (event: InkWorkerEvent) => posted.push(event),
    addEventListener: (_type: string, fn: Listener) => {
      listener = fn;
    },
    // Frames are queued, not run: a test runs them with `runFrames`.
    requestAnimationFrame: (cb: () => void) => frames.push(cb),
  };
  const worker = await import("../worker/ink-worker");
  pointInPolygon = worker.pointInPolygon;
  liveForRenderer = worker.liveForRenderer;
});

function send(message: InkWorkerMessage): void {
  assert.ok(listener, "the worker registered its listener");
  listener({ data: message });
}

function events<T extends InkWorkerEvent["type"]>(
  type: T,
): Extract<InkWorkerEvent, { type: T }>[] {
  return posted.filter((event) => event.type === type) as Extract<
    InkWorkerEvent,
    { type: T }
  >[];
}

function last<T extends InkWorkerEvent["type"]>(
  type: T,
): Extract<InkWorkerEvent, { type: T }> {
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
function stroke(
  samples: Float32Array,
  count: number,
  tool: InkStrokeHeader["tool"] = "pen",
): void {
  strokeId += 1;
  const h = header(tool);
  const empty = { buffer: new Float32Array(0), count: 0 };
  send({ type: "stroke-begin", header: h, sample: { buffer: samples, count } });
  send({ type: "stroke-end", header: h, sample: empty });
}

/** Draw one stroke as a straight line from (x0, y) rightwards. */
function draw(
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

function fresh(): void {
  posted.length = 0;
  send({
    type: "init",
    canvas: null,
    width: 400,
    height: 600,
    dpr: 1,
    mode: "clone",
    codec: "identity",
  });
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

test("the saved stroke keeps every drawn sample: no refit on lift", () => {
  fresh();
  // A wavy line: a refit or a coarse simplification would move these points.
  const count = 40;
  const samples = new Float32Array(count * INK_SAMPLE_STRIDE);
  const drawn: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = 20 + i * 7;
    const y = 200 + Math.round(12 * Math.sin(i / 2));
    drawn.push(x, y);
    samples[i * INK_SAMPLE_STRIDE] = x;
    samples[i * INK_SAMPLE_STRIDE + 1] = y;
    samples[i * INK_SAMPLE_STRIDE + 2] = 0.5;
    samples[i * INK_SAMPLE_STRIDE + 3] = i;
  }
  stroke(samples, count);
  const saved = [...last("stroke-committed").points];
  // Only exactly collinear samples may go; every saved point is a drawn one.
  for (let i = 0; i < saved.length; i += 2) {
    const at = drawn.findIndex((v, k) => k % 2 === 0 && v === saved[i] && drawn[k + 1] === saved[i + 1]);
    assert.ok(at >= 0, `saved point ${saved[i]},${saved[i + 1]} was drawn`);
  }
  assert.ok(saved.length / 2 >= count / 2, `kept ${saved.length / 2} of ${count}`);
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

test("the eraser's reach is the radius the page sends, so it stays fixed on screen", () => {
  fresh();
  draw(10, 50);
  draw(10, 90);
  // Zoomed in, the reach in page units is small: a sweep between the lines misses both.
  send({ type: "erase", from: { x: 70, y: 70 }, to: { x: 70, y: 70 }, radius: 5 });
  assert.equal(last("page-state").strokes, 2);
  // Zoomed out, the same on-screen reach covers both lines.
  send({ type: "erase", from: { x: 70, y: 70 }, to: { x: 70, y: 70 }, radius: 25 });
  assert.equal(last("page-state").strokes, 0);
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
  assert.deepEqual(
    last("selected").indices,
    [0],
    "the moved stroke is found at its new place",
  );
  send({ type: "delete-selection" });
  assert.equal(last("page-state").strokes, 1);
  send({ type: "undo" });
  assert.equal(last("page-state").strokes, 2);
  send({ type: "undo" }); // the move
  send({ type: "lasso", polygon: [0, 0, 400, 0, 400, 100, 0, 100] });
  assert.deepEqual(
    last("selected").indices,
    [0],
    "undoing the move puts it back",
  );
});

test("pasted strokes land as one undoable step and come back selected", () => {
  fresh();
  draw(10, 50);
  send({
    type: "add-strokes",
    strokes: [0, 1].map((k) => makeInkStroke({ points: [10, 200 + k * 40, 100, 200 + k * 40], pressures: [128, 128] })),
  });
  assert.equal(last("page-state").strokes, 3);
  assert.deepEqual(last("selected").indices, [1, 2]);
  assert.ok(last("selected").bounds);
  send({ type: "undo" });
  assert.equal(last("page-state").strokes, 1, "one undo takes the whole paste");
  send({ type: "redo" });
  assert.equal(last("page-state").strokes, 3);
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
  assert.equal(saved.cleared, false);
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

test("an emptied loaded page saves as cleared", async () => {
  fresh();
  draw(10, 50);
  send({ type: "erase", from: { x: 70, y: 20 }, to: { x: 70, y: 80 } });
  assert.equal(last("page-state").strokes, 0);
  send({ type: "save-page", requestId: 2 });
  await settle();
  const saved = last("page-saved");
  assert.equal(saved.bytes, null);
  assert.equal(saved.cleared, true);
});

test("a page still loading never reports cleared", async () => {
  fresh();
  draw(10, 50);
  send({ type: "save-page", requestId: 1 });
  await settle();
  const bytes = last("page-saved").bytes;
  assert.ok(bytes);
  fresh();
  send({ type: "load-page", pageIndex: 1, chunk: bytes });
  send({ type: "save-page", requestId: 2 });
  await settle();
  assert.equal(last("page-saved").requestId, 2);
  assert.equal(last("page-saved").cleared, false);
});

test("replace-page swaps the model and page-model answers with the current one", () => {
  fresh();
  draw(10, 50);
  send({ type: "page-model", requestId: 3 });
  const model = last("page-model");
  assert.equal(model.page.strokes.length, 1);
  send({ type: "replace-page", pageIndex: 0, page: { ...model.page, strokes: [] } });
  assert.equal(last("page-state").strokes, 0);
});

test("replace-page for another page is ignored (21-01)", () => {
  fresh();
  draw(10, 50);
  send({ type: "page-model", requestId: 4 });
  const model = last("page-model");
  send({ type: "replace-page", pageIndex: 1, page: { ...model.page, strokes: [] } });
  assert.equal(last("page-state").strokes, 1);
  send({ type: "page-model", requestId: 5 });
  assert.equal(last("page-model").page.strokes.length, 1);
});

/** A page of `count` strokes, packed as the sidecar stores it. */
async function packed(count: number): Promise<Uint8Array> {
  fresh();
  for (let i = 0; i < count; i += 1) draw(10, 50 + i * 60);
  send({ type: "save-page", requestId: 99 });
  await settle();
  const bytes = last("page-saved").bytes;
  assert.ok(bytes);
  return bytes;
}

/** Let several decodes run one after another. */
async function settleAll(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await settle();
}

test("a save posts the index of the page it packed, even if the page changes during it (19-02)", async () => {
  fresh();
  draw(10, 50);
  send({ type: "save-page", requestId: 11 });
  send({ type: "load-page", pageIndex: 1, chunk: null });
  await settleAll();
  const saved = events("page-saved").find((event) => event.requestId === 11);
  assert.ok(saved);
  assert.equal(saved.pageIndex, 0);
  assert.equal(saved.strokes, 1);
});

test("the page index moves only once the new page is in place (19-03)", async () => {
  const bytes = await packed(2);
  fresh();
  draw(10, 50);
  send({ type: "load-page", pageIndex: 1, chunk: bytes });
  // Mid-decode the worker still holds page 0, so it names page 0.
  send({ type: "page-model", requestId: 12 });
  assert.equal(last("page-model").pageIndex, 0);
  assert.equal(last("page-model").page.strokes.length, 1);
  await settleAll();
  assert.equal(last("page-state").pageIndex, 1);
  assert.equal(last("page-state").strokes, 2);
});

test("a page that fails to decode leaves the old page and its index (19-03)", async () => {
  fresh();
  draw(10, 50);
  send({ type: "load-page", pageIndex: 1, chunk: new Uint8Array([1, 2, 3]) });
  await settleAll();
  assert.ok(events("error").length > 0);
  send({ type: "save-page", requestId: 13 });
  await settleAll();
  const saved = last("page-saved");
  assert.equal(saved.requestId, 13);
  assert.equal(saved.pageIndex, 0);
  assert.equal(saved.strokes, 1);
});

test("quick page changes A -> B -> C end on C (19-06)", async () => {
  const b = await packed(1);
  const c = await packed(3);
  fresh();
  send({ type: "load-page", pageIndex: 1, chunk: b });
  send({ type: "load-page", pageIndex: 2, chunk: c });
  await settleAll();
  assert.equal(last("page-state").pageIndex, 2);
  assert.equal(last("page-state").strokes, 3);
});

test("of several loads that wait, only the latest runs (19-06)", async () => {
  const b = await packed(1);
  const c = await packed(2);
  const d = await packed(3);
  fresh();
  send({ type: "load-page", pageIndex: 1, chunk: b });
  send({ type: "load-page", pageIndex: 2, chunk: c });
  send({ type: "load-page", pageIndex: 3, chunk: d });
  await settleAll();
  const shown = events("page-state").map((event) => event.pageIndex);
  assert.ok(!shown.includes(2), `page 2 was skipped, saw ${shown.join(",")}`);
  assert.equal(last("page-state").pageIndex, 3);
  assert.equal(last("page-state").strokes, 3);
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
    for (let t = 0; t < 1; t += 0.1)
      points.push(ax! + (bx! - ax!) * t, ay! + (by! - ay!) * t);
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
  assert.ok(
    fitted.points.length <= 12,
    "the fitted rectangle is corners, not the scribble",
  );
});

test("pointInPolygon follows the even-odd rule", () => {
  const square = [0, 0, 10, 0, 10, 10, 0, 10];
  assert.equal(pointInPolygon(5, 5, square), true);
  assert.equal(pointInPolygon(15, 5, square), false);
  assert.equal(pointInPolygon(5, -1, square), false);
});
test("live stroke simplifies dense staircases so live curves match commit curves", () => {
  fresh();
  const count = 30;
  const samples = new Float32Array(count * INK_SAMPLE_STRIDE);
  for (let i = 0; i < count; i += 1) {
    samples[i * INK_SAMPLE_STRIDE] = i * 2;
    samples[i * INK_SAMPLE_STRIDE + 1] = Math.round(i * 1.5);
    samples[i * INK_SAMPLE_STRIDE + 2] = 0.5;
    samples[i * INK_SAMPLE_STRIDE + 3] = i;
  }
  send({
    type: "stroke-begin",
    header: header(),
    sample: { buffer: samples.subarray(0, 4), count: 1 },
  });
  send({
    type: "samples",
    header: header(),
    sample: { buffer: samples.subarray(4), count: count - 1 },
  });
  send({
    type: "stroke-end",
    header: header(),
    sample: { buffer: new Float32Array(0), count: 0 },
  });
  const committed = last("stroke-committed");
  assert.ok(committed.points.length / 2 < count, "committed stroke eliminated staircases");
});

test("the draw loop stops when idle and any message wakes it (19-05)", async () => {
  fresh();
  await settle();
  runFrames();
  assert.equal(frames.length, 0, "an idle page asks for no frames");
  const wakers: InkWorkerMessage[] = [
    { type: "resize", width: 300, height: 500, dpr: 2 },
    { type: "undo" },
    { type: "ink-shown", pageIndex: 0, count: 0 },
    { type: "select-clear" },
  ];
  for (const message of wakers) {
    posted.length = 0;
    send(message);
    assert.equal(frames.length, 1, `${message.type} asks for a frame`);
    runFrames();
    assert.ok(events("frame").length > 0, `${message.type} is drawn`);
    assert.equal(frames.length, 0, `${message.type} lets the loop idle again`);
  }
});

test("the loop runs for a whole live stroke and idles after it (19-05)", async () => {
  fresh();
  await settle();
  runFrames();
  strokeId += 1;
  const h = header();
  const one = new Float32Array([10, 10, 0.5, 0]);
  send({ type: "stroke-begin", header: h, sample: { buffer: one, count: 1 } });
  runFrames(3);
  assert.equal(frames.length, 1, "a live stroke keeps asking for frames");
  send({ type: "stroke-end", header: h, sample: { buffer: new Float32Array(0), count: 0 } });
  runFrames();
  assert.equal(frames.length, 0);
});

test("a page that finishes loading after the loop idled is drawn (19-05)", async () => {
  fresh();
  draw(10, 50);
  send({ type: "save-page", requestId: 9 });
  await settle();
  const bytes = last("page-saved").bytes!;
  runFrames();
  send({ type: "load-page", pageIndex: 0, chunk: bytes });
  runFrames();
  await settle();
  assert.equal(frames.length, 1, "the loaded page asks for a frame");
  runFrames();
});

test("transferred sample buffers still come back once the loop idled (19-05)", async () => {
  fresh();
  send({ type: "init", canvas: null, width: 400, height: 600, dpr: 1, mode: "transfer", codec: "identity" });
  await settle();
  runFrames();
  posted.length = 0;
  strokeId += 1;
  const h = header();
  send({ type: "stroke-begin", header: h, sample: { buffer: new Float32Array([10, 10, 0.5, 0]), count: 1 } });
  send({ type: "stroke-end", header: h, sample: { buffer: new Float32Array([20, 10, 0.5, 1]), count: 1 } });
  runFrames();
  const returned = events("samples-returned").flatMap((e) => e.buffers);
  assert.equal(returned.length, 2);
  assert.equal(frames.length, 0);
  send({ type: "init", canvas: null, width: 400, height: 600, dpr: 1, mode: "clone", codec: "identity" });
  runFrames();
});

test("the live stroke's real part is the stroke that will be saved, whatever the predicted tail", () => {
  // A small wavy stroke, sampled densely: simplification here keeps few
  // vertices, so any extra point changes which ones it keeps.
  const points: number[] = [];
  const pressures: number[] = [];
  for (let i = 0; i <= 120; i += 1) {
    const t = i / 120;
    points.push(100 + t * 400 + 7 * Math.cos(t * 40), 300 + 9 * Math.sin(t * 40));
    pressures.push(128);
  }
  const saved = packInkStroke(points, pressures, { tolerance: INK_PACK_TOLERANCE });
  // Two predicted samples that overshoot sideways, as a guess about a hand can.
  const live = liveForRenderer({
    header: header(),
    points: [...points, 520, 340, 540, 360],
    pressures: [...pressures, 128, 128],
    realSamples: 121,
    changed: true,
  });
  const real = saved.points.length / 2;
  assert.equal(live.realCount, real, "the real points are the saved ones, counted");
  assert.deepEqual(
    Array.from(live.x.subarray(0, real), (x, i) => [x, live.y[i]]),
    Array.from({ length: real }, (_, i) => [
      Math.fround(saved.points[2 * i]!),
      Math.fround(saved.points[2 * i + 1]!),
    ]),
  );
  assert.deepEqual(Array.from(live.x.subarray(real)), [520, 540], "the tail is drawn after them");
  assert.deepEqual(Array.from(live.y.subarray(real)), [340, 360]);
});
