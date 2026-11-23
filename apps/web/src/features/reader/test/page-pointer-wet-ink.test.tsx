/**
 * A PDF stroke does not jump at either end ("it is jumping before and after
 * pen down").
 *
 * - Before: the wet ink starts where the pen touched.
 * - After: the wet ink stays on screen until the saved mark has replaced it,
 *   and the stroke ends where the pen lifted, not a filter lag short of it.
 * - The page box is measured once per pointer event, not once per sample.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { renderHook } from "@/lib/test/react-harness";
import { usePagePointer, type PagePointerDeps } from "../ui/pdf-reader/use-page-pointer";

before(loadTestCore);

const g = globalThis as unknown as { window?: unknown; requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
const previousWindow = g.window;
const previousRaf = g.requestAnimationFrame;
const previousCancel = g.cancelAnimationFrame;
before(() => {
  g.window ??= globalThis;
  // A frame runs after the call returns, as in a browser: a callback run inside
  // the call would see its frame id assigned after it had cleared it.
  const cancelled = new Set<number>();
  let frames = 0;
  g.requestAnimationFrame = (f: () => void) => {
    const id = ++frames;
    queueMicrotask(() => {
      if (!cancelled.delete(id)) f();
    });
    return id;
  };
  g.cancelAnimationFrame = (id: number) => {
    cancelled.add(id);
  };
});
after(() => {
  g.window = previousWindow;
  g.requestAnimationFrame = previousRaf;
  g.cancelAnimationFrame = previousCancel;
});

let rectReads = 0;
const row = {
  dataset: { page: "1" },
  style: {} as Record<string, string>,
  querySelector: () => null,
  getBoundingClientRect: () => {
    rectReads += 1;
    return { left: 0, top: 0, right: 600, bottom: 800, width: 600, height: 800 };
  },
  setPointerCapture: () => {},
  releasePointerCapture: () => {},
  hasPointerCapture: () => false,
};

let clock = 0;
function sample(pointerId: number, x: number, y: number) {
  clock += 4;
  return { width: 1, height: 1, clientX: x, clientY: y, timeStamp: clock, pointerId };
}
function ev(pointerId: number, x: number, y: number, coalesced?: ReturnType<typeof sample>[]) {
  const native = { ...sample(pointerId, x, y), getCoalescedEvents: coalesced ? () => coalesced : undefined };
  return {
    pointerId,
    pointerType: "pen",
    pressure: 0.5,
    button: 0,
    buttons: 1,
    clientX: x,
    clientY: y,
    timeStamp: native.timeStamp,
    currentTarget: row,
    target: row,
    nativeEvent: native,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

type Draft = { anchor: { zoteroPosition?: { paths?: number[][] } } };

function deps(persistDraft: (draft: Draft) => Promise<unknown>): PagePointerDeps {
  return {
    canCreate: true,
    createTool: "ink",
    createColor: "#ff0000",
    inkEditable: true,
    selectedAnnId: null,
    pageSize: { width: 600, height: 800 },
    scale: 1,
    rotation: 0,
    pageGeometries: { current: new Map() },
    annotations: [],
    annotationsByPage: new Map(),
    persistDraft: persistDraft as unknown as PagePointerDeps["persistDraft"],
    removeLocal: (async () => {}) as unknown as PagePointerDeps["removeLocal"],
    saveAnchor: (async () => {}) as unknown as PagePointerDeps["saveAnchor"],
  } as PagePointerDeps;
}

const toPdf = (x: number, y: number) =>
  readyCore().screenPointToPdf(x, y, { pageWidth: 600, pageHeight: 800, scale: 1, rotation: 0 });

function inkPath(shape: unknown): number[] {
  const s = shape as { kind?: string; path?: number[] } | null;
  assert.equal(s?.kind, "ink", "no wet ink on screen");
  return s!.path!;
}

test("the wet ink starts where the pen touched", async () => {
  const h = await renderHook(usePagePointer, deps(async () => null));
  h.current.onPagePointerDown(1, ev(1, 100, 100));
  await h.flush();
  const at = toPdf(100, 100);
  const first = inkPath(h.current.draftShape).slice(0, 2);
  assert.ok(Math.hypot(first[0]! - at.x, first[1]! - at.y) < 1e-6, `starts at ${first}, pen at ${at.x},${at.y}`);
  h.current.onPagePointerMove(ev(1, 120, 110));
  await h.flush();
  const moved = inkPath(h.current.draftShape).slice(0, 2);
  assert.deepEqual(moved, first, "the first point moved once the stroke grew");
  await h.unmount();
});

test("the saved stroke ends where the pen lifted", async () => {
  const saved: Draft[] = [];
  const h = await renderHook(usePagePointer, deps(async (d) => (saved.push(d), null)));
  h.current.onPagePointerDown(1, ev(1, 100, 100));
  for (let i = 1; i <= 10; i += 1) h.current.onPagePointerMove(ev(1, 100 + 12 * i, 100 + 6 * i));
  // A fast flick: the lift is well past the last move.
  h.current.onPagePointerUp(1, ev(1, 260, 180));
  await h.flush();
  const path = saved[0]?.anchor.zoteroPosition?.paths?.[0] ?? [];
  const end = toPdf(260, 180);
  const gap = Math.hypot(path.at(-2)! - end.x, path.at(-1)! - end.y);
  assert.ok(gap < 0.3, `the stroke stops ${gap.toFixed(2)} pt short of the lift`);
  await h.unmount();
});

test("the wet ink stays until the saved mark has replaced it", async () => {
  let resolve!: () => void;
  const h = await renderHook(
    usePagePointer,
    deps(() => new Promise((r) => (resolve = () => r(null)))),
  );
  h.current.onPagePointerDown(1, ev(1, 100, 100));
  h.current.onPagePointerMove(ev(1, 140, 130));
  h.current.onPagePointerMove(ev(1, 180, 160));
  h.current.onPagePointerUp(1, ev(1, 180, 160));
  await h.flush();
  inkPath(h.current.draftShape);
  resolve();
  await h.flush();
  assert.equal(h.current.draftShape, null, "the wet ink outlived the save");
  await h.unmount();
});

test("a stroke begun while the last one saves keeps its wet ink", async () => {
  const pending: (() => void)[] = [];
  const h = await renderHook(
    usePagePointer,
    deps(() => new Promise((r) => pending.push(() => r(null)))),
  );
  h.current.onPagePointerDown(1, ev(1, 100, 100));
  h.current.onPagePointerMove(ev(1, 140, 130));
  h.current.onPagePointerUp(1, ev(1, 180, 160));
  h.current.onPagePointerDown(1, ev(2, 300, 300));
  h.current.onPagePointerMove(ev(2, 340, 330));
  pending[0]!();
  await h.flush();
  const first = inkPath(h.current.draftShape).slice(0, 2);
  const at = toPdf(300, 300);
  assert.ok(Math.hypot(first[0]! - at.x, first[1]! - at.y) < 1e-6, "the second stroke's wet ink was cleared");
  await h.unmount();
});

test("the page is measured once per move, not once per merged sample", async () => {
  const h = await renderHook(usePagePointer, deps(async () => null));
  h.current.onPagePointerDown(1, ev(1, 100, 100));
  h.current.onPagePointerMove(ev(1, 104, 102));
  const merged = Array.from({ length: 16 }, (_, i) => sample(1, 106 + 3 * i, 103 + i));
  rectReads = 0;
  h.current.onPagePointerMove(ev(1, 151, 118, merged));
  // One for the point, one for the area the stroke may be drawn in.
  assert.ok(rectReads <= 2, `${rectReads} layout reads for one move`);
  await h.unmount();
});

test("the wet ink reaches the lift before the save lands, so no tail pops in", async () => {
  let resolve!: () => void;
  const h = await renderHook(
    usePagePointer,
    deps(() => new Promise((r) => (resolve = () => r(null)))),
  );
  h.current.onPagePointerDown(1, ev(1, 100, 100));
  for (let i = 1; i <= 10; i += 1) h.current.onPagePointerMove(ev(1, 100 + 12 * i, 100 + 6 * i));
  await h.flush();
  h.current.onPagePointerUp(1, ev(1, 260, 180));
  await h.flush();
  const path = inkPath(h.current.draftShape);
  const end = toPdf(260, 180);
  const gap = Math.hypot(path.at(-2)! - end.x, path.at(-1)! - end.y);
  assert.ok(gap < 0.3, `the wet ink stops ${gap.toFixed(2)} pt short of the lift while saving`);
  resolve();
  await h.flush();
  await h.unmount();
});
