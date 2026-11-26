/**
 * What the row keeps while the notes' pen draws: the eraser end erases and
 * the barrel button lassoes through the row (the pen lets them fall through), and
 * the row's cancel (a second finger, a pinch) ends the pens' strokes too.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { ReaderAnnotation } from "@weaveforge/core";

import { loadTestCore } from "@/lib/test/load-test-core";
import { renderHook } from "@/lib/test/react-harness";
import { usePagePointer, type PagePointerDeps } from "../ui/pdf-reader/use-page-pointer";

before(loadTestCore);

const g = globalThis as unknown as { window?: unknown; requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
const previous = { window: g.window, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
before(() => {
  g.window ??= globalThis;
  // A frame lands after the handler returns, as in a browser.
  g.requestAnimationFrame = (f: () => void) => {
    queueMicrotask(f);
    return 1;
  };
  g.cancelAnimationFrame = () => {};
});
after(() => {
  g.window = previous.window;
  g.requestAnimationFrame = previous.raf;
  g.cancelAnimationFrame = previous.caf;
});

const row = {
  dataset: { page: "1" },
  style: {} as Record<string, string>,
  querySelector: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 800, width: 600, height: 800 }),
  setPointerCapture: () => {},
  releasePointerCapture: () => {},
  hasPointerCapture: () => false,
};

let clock = 0;
function ev(pointerId: number, x: number, y: number, button: number, buttons: number) {
  clock += 16;
  const native = { width: 1, height: 1, clientX: x, clientY: y, timeStamp: clock, pointerId };
  return {
    pointerId,
    pointerType: "pen",
    pressure: 0.5,
    button,
    buttons,
    clientX: x,
    clientY: y,
    timeStamp: clock,
    currentTarget: row,
    target: row,
    nativeEvent: native,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

const mark = {
  id: "m1",
  origin: "local",
  type: "ink",
  color: "#000000",
  text: "",
  comment: "",
  tags: [],
  sortIndex: "00000|000000|00000",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  anchor: { zoteroPosition: { pageIndex: 0, width: 2, paths: [[100, 100, 100, 700]] } },
} as unknown as ReaderAnnotation;

function deps(writes: string[]): PagePointerDeps {
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
    annotations: [mark],
    annotationsByPage: new Map([[1, [mark]]]),
    persistDraft: (async () => null) as unknown as PagePointerDeps["persistDraft"],
    removeLocal: (async () => {
      writes.push("remove");
    }) as unknown as PagePointerDeps["removeLocal"],
    saveAnchor: (async () => {
      writes.push("save");
    }) as unknown as PagePointerDeps["saveAnchor"],
  } as unknown as PagePointerDeps;
}

test("the eraser end erases through the row with the pen tool in hand", async () => {
  const writes: string[] = [];
  const h = await renderHook(usePagePointer, deps(writes));
  // Across the stroke at x = 100 (PDF y is up; the row is 800 tall).
  h.current.onPagePointerDown(1, ev(7, 60, 400, 5, 32));
  h.current.onPagePointerMove(ev(7, 100, 400, -1, 32));
  h.current.onPagePointerMove(ev(7, 140, 400, -1, 32));
  h.current.onPagePointerUp(1, ev(7, 140, 400, 5, 0));
  await h.flush();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(writes.length > 0, "the eraser end did not erase");
  await h.unmount();
});

test("the barrel button lassoes through the row with the pen tool in hand", async () => {
  const writes: string[] = [];
  const h = await renderHook(usePagePointer, deps(writes));
  // A ring round the stroke at x = 100.
  h.current.onPagePointerDown(1, ev(8, 60, 50, 2, 2));
  h.current.onPagePointerMove(ev(8, 140, 50, -1, 2));
  h.current.onPagePointerMove(ev(8, 140, 750, -1, 2));
  h.current.onPagePointerMove(ev(8, 60, 750, -1, 2));
  await h.flush();
  assert.ok(h.current.lassoPath && h.current.lassoPath.length >= 6, "the barrel drew no lasso");
  h.current.onPagePointerUp(1, ev(8, 60, 50, 2, 0));
  await h.flush();
  assert.deepEqual([...h.current.lassoed], ["m1"]);
  assert.equal(writes.length, 0, "the barrel wrote ink");
  await h.unmount();
});

test("a second finger or a pinch ends the pens' strokes", async () => {
  const h = await renderHook(usePagePointer, deps([]));
  let ended = 0;
  const off = h.current.registerPenCancel(() => (ended += 1));
  h.current.cancelStroke();
  assert.equal(ended, 1);
  off();
  h.current.cancelStroke();
  assert.equal(ended, 1, "an unmounted pen was still cancelled");
  await h.unmount();
});
