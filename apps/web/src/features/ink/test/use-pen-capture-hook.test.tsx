/**
 * The hook's own state: `penSeen` is what lets a finger scroll the sheet once a
 * pen has written, so the first pen-down must set it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import {
  INK_PEN_ONLY_STORAGE_KEY,
  usePenCapture,
  type PenCaptureHandle,
  type PenOnlyStorage,
} from "../application/use-pen-capture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The frame pump needs a window; no frame ever has to run here.
(globalThis as { window?: unknown }).window ??= { requestAnimationFrame: () => 0, cancelAnimationFrame() {} };

function penDown(pointerType: string) {
  return {
    pointerId: 1,
    pointerType,
    pressure: 0.5,
    clientX: 10,
    clientY: 10,
    timeStamp: 1_000,
    nativeEvent: { width: 1, height: 1 },
    currentTarget: { setPointerCapture() {} },
    preventDefault() {},
  } as unknown as React.PointerEvent<HTMLCanvasElement>;
}

function memoryStorage(): PenOnlyStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

function mount(penOnlyStorage: PenOnlyStorage | null): () => PenCaptureHandle {
  let handle!: PenCaptureHandle;
  function Host() {
    handle = usePenCapture({
      element: () => null,
      project: (x, y) => ({ x, y }),
      pageIndex: 0,
      tool: "pen",
      width: 2,
      colour: "text",
      penOnlyStorage,
    });
    return null;
  }
  act(() => {
    create(createElement(Host));
  });
  return () => handle;
}

test("the first pen-down marks the pen as seen", () => {
  const get = mount(null);
  const handle = get();
  assert.equal(handle.penSeen, false);
  act(() => handle.handlers.onPointerDown(penDown("pen")));
  assert.equal(get().penSeen, true);
});

test("the guard the first pen raises survives a remount", () => {
  const storage = memoryStorage();
  const first = mount(storage);
  act(() => first().handlers.onPointerDown(penDown("pen")));
  assert.equal(first().penOnly, true);
  assert.equal(storage.map.get(INK_PEN_ONLY_STORAGE_KEY), "1");
  const second = mount(storage);
  assert.equal(second().penOnly, true, "a fresh page keeps the finger scrolling");
});

test("a device that said no keeps its no", () => {
  const storage = memoryStorage();
  storage.map.set(INK_PEN_ONLY_STORAGE_KEY, "0");
  const get = mount(storage);
  act(() => get().handlers.onPointerDown(penDown("pen")));
  assert.equal(get().penOnly, false);
  assert.equal(storage.map.get(INK_PEN_ONLY_STORAGE_KEY), "0");
});

test("a hovering pen counts before it lands", () => {
  const get = mount(memoryStorage());
  act(() => get().handlers.onPointerMove(penDown("pen")));
  assert.equal(get().penSeen, true);
  assert.equal(get().penOnly, true);
});
