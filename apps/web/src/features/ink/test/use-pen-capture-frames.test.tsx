/**
 * The frame pump runs only while a stroke is in progress (M04).
 *
 * Every ink page used to request a frame forever, idle or not: six pages on a
 * workspace meant six 60 fps loops doing nothing. A stroke still gets its
 * samples to the worker once per frame; between strokes no frame is requested.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import {
  usePenCapture,
  type PenCaptureHandle,
} from "../application/use-pen-capture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A frame clock the test advances by hand. */
const frames = new Map<number, () => void>();
let nextId = 0;
(globalThis as { window?: unknown }).window = {
  requestAnimationFrame(cb: () => void) {
    nextId += 1;
    frames.set(nextId, cb);
    return nextId;
  },
  cancelAnimationFrame(id: number) {
    frames.delete(id);
  },
};

/** Run the frames requested so far; frames they request wait for the next call. */
function runFrame(): void {
  const due = [...frames.values()];
  frames.clear();
  for (const cb of due) cb();
}

function pointer(t: number, x = 10) {
  return {
    pointerId: 1,
    pointerType: "pen",
    pressure: 0.5,
    clientX: x,
    clientY: 10,
    timeStamp: t,
    nativeEvent: { width: 1, height: 1 },
    currentTarget: { setPointerCapture() {} },
    preventDefault() {},
  } as unknown as React.PointerEvent<HTMLCanvasElement>;
}

function mount(): { get: () => PenCaptureHandle; root: ReactTestRenderer } {
  let handle!: PenCaptureHandle;
  function Host() {
    handle = usePenCapture({
      element: () => null,
      project: (x, y) => ({ x, y }),
      pageIndex: 0,
      tool: "pen",
      width: 2,
      colour: "text",
      penOnlyStorage: null,
    });
    return null;
  }
  let root!: ReactTestRenderer;
  act(() => {
    root = create(createElement(Host));
  });
  return { get: () => handle, root };
}

test("an idle ink page requests no frames", () => {
  frames.clear();
  const { root } = mount();
  assert.equal(frames.size, 0, "nothing to send, so no frame");
  act(() => root.unmount());
});

test("a stroke pumps once per frame until the pen comes up, then stops", () => {
  frames.clear();
  const { get, root } = mount();
  act(() => get().handlers.onPointerDown(pointer(1_000)));
  assert.equal(get().session.active, true);
  assert.equal(frames.size, 1, "the pen-down starts the pump");

  act(() => get().handlers.onPointerMove(pointer(1_008, 14)));
  assert.equal(frames.size, 1, "a move does not start a second loop");
  runFrame();
  assert.equal(frames.size, 1, "the pump keeps going while the stroke runs");

  act(() => get().handlers.onPointerUp(pointer(1_016, 18)));
  runFrame();
  assert.equal(frames.size, 0, "after the pen comes up no frame is requested");

  // The next stroke starts the pump again.
  act(() => get().handlers.onPointerDown(pointer(2_000)));
  assert.equal(frames.size, 1);
  act(() => root.unmount());
  assert.equal(frames.size, 0, "unmounting cancels the pending frame");
});

test("a cancelled pointer stops the pump", () => {
  frames.clear();
  const { get, root } = mount();
  act(() => get().handlers.onPointerDown(pointer(1_000)));
  act(() => get().handlers.onPointerCancel(pointer(1_010)));
  runFrame();
  assert.equal(frames.size, 0);
  act(() => root.unmount());
});
