/**
 * The eraser's writes land in the order they were made (P2-204).
 *
 * One drag trims a mark, then removes it once no stroke is left. Each write
 * was fired without waiting, so the remove could land before the trim, and the
 * trim, landing last, wrote the mark back. Undo could also run before the
 * erase it undoes was saved.
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
function ev(x: number, y: number) {
  clock += 16;
  const native = { width: 1, height: 1, clientX: x, clientY: y, timeStamp: clock, pointerId: 1 };
  return {
    pointerId: 1,
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

// Two full-height strokes, so the eraser hits them wherever y lands.
const mark = {
  id: "ink-1",
  type: "ink",
  origin: "local",
  page: 1,
  anchor: {
    zoteroPosition: {
      pageIndex: 0,
      width: 1,
      paths: [
        [100, 0, 100, 200, 100, 400, 100, 600, 100, 800],
        [300, 0, 300, 200, 300, 400, 300, 600, 300, 800],
      ],
    },
  },
};

test("the mark is not removed before its trim has landed", async () => {
  const log: string[] = [];
  const pending: (() => void)[] = [];
  const h = await renderHook(usePagePointer, {
    canCreate: true,
    createTool: "erase",
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
      log.push("remove");
      return true;
    }) as unknown as PagePointerDeps["removeLocal"],
    saveAnchor: ((_ann: unknown, _next: unknown) => {
      const n = log.filter((e) => e.startsWith("save")).length + 1;
      log.push(`save${n}:start`);
      return new Promise<void>((resolve) => {
        pending.push(() => {
          log.push(`save${n}:end`);
          resolve();
        });
      });
    }) as unknown as PagePointerDeps["saveAnchor"],
  } as unknown as PagePointerDeps);

  h.current.onPagePointerDown(1, ev(100, 400));
  h.current.onPagePointerMove(ev(300, 400));
  await h.flush();
  assert.deepEqual(log, ["save1:start"], "the remove started before the trim was saved");

  pending.shift()!();
  await h.flush();
  assert.deepEqual(log, ["save1:start", "save1:end", "remove"]);

  h.current.onPagePointerUp(1, ev(300, 400));
  await h.unmount();
});
