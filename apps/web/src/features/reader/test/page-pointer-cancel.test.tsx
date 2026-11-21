/**
 * A cancelled pointer drops its stroke and lets the next one draw (P1-9).
 *
 * The browser sends `pointercancel` (or `lostpointercapture`) when the system
 * takes the pointer away, and never the `pointerup`. The stroke in hand must
 * not be saved, and the pointer that owned it must not keep blocking the pen.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { loadTestCore } from "@/lib/test/load-test-core";
import { renderHook } from "@/lib/test/react-harness";
import { usePagePointer, type PagePointerDeps } from "../ui/pdf-reader/use-page-pointer";

before(loadTestCore);

const g = globalThis as unknown as { window?: unknown; requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
const previousWindow = g.window;
const previousRaf = g.requestAnimationFrame;
const previousCancel = g.cancelAnimationFrame;
before(() => {
  // The previews schedule through `window.requestAnimationFrame`.
  g.window ??= globalThis;
  g.requestAnimationFrame = (f: () => void) => {
    f();
    return 0;
  };
  g.cancelAnimationFrame = () => {};
});
after(() => {
  g.window = previousWindow;
  g.requestAnimationFrame = previousRaf;
  g.cancelAnimationFrame = previousCancel;
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
function ev(pointerId: number, x: number, y: number) {
  clock += 16;
  const native = { width: 1, height: 1, clientX: x, clientY: y, timeStamp: clock, pointerId };
  return {
    pointerId,
    pointerType: "pen",
    pressure: 0.5,
    button: 0,
    buttons: 1,
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

function deps(saved: unknown[]): PagePointerDeps {
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
    persistDraft: (async (draft: unknown) => {
      saved.push(draft);
      return null;
    }) as unknown as PagePointerDeps["persistDraft"],
    removeLocal: (async () => {}) as unknown as PagePointerDeps["removeLocal"],
    saveAnchor: (async () => {}) as unknown as PagePointerDeps["saveAnchor"],
  } as PagePointerDeps;
}

function draw(p: { current: ReturnType<typeof usePagePointer> }, id: number, from: number) {
  p.current.onPagePointerDown(1, ev(id, from, from));
  p.current.onPagePointerMove(ev(id, from + 40, from + 30));
  p.current.onPagePointerMove(ev(id, from + 80, from + 60));
}

test("a cancelled stroke is not saved, and the next pointer draws", async () => {
  const saved: unknown[] = [];
  const h = await renderHook(usePagePointer, deps(saved));

  draw(h, 1, 100);
  h.current.onPagePointerCancel(ev(1, 180, 160));
  await h.flush();
  assert.equal(saved.length, 0, "the cancelled stroke was saved");

  draw(h, 2, 300);
  h.current.onPagePointerUp(1, ev(2, 380, 360));
  await h.flush();
  assert.equal(saved.length, 1, "the stroke after a cancel was not saved");

  await h.unmount();
});

test("an up after a cancel does not save the cancelled stroke", async () => {
  const saved: unknown[] = [];
  const h = await renderHook(usePagePointer, deps(saved));

  draw(h, 1, 100);
  h.current.onPagePointerCancel(ev(1, 180, 160));
  h.current.onPagePointerUp(1, ev(1, 180, 160));
  await h.flush();
  assert.equal(saved.length, 0);

  await h.unmount();
});
