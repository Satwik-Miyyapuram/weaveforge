/**
 * The worker's `frame` message must not re-render the host.
 *
 * The worker posts `frame` after every tick, and any message to the worker
 * starts a tick. When `frame` was React state, each one re-rendered the whole
 * ink sheet, whose effects posted to the worker again: a render every
 * animation frame, which made switching tabs slow.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { usePenCapture, type InkWorkerLike } from "../application/use-pen-capture";
import { loadTestCore } from "@/lib/test/load-test-core";

before(loadTestCore);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { window?: unknown }).window ??= {
  requestAnimationFrame: () => 0,
  cancelAnimationFrame() {},
  devicePixelRatio: 1,
};

test("a frame message calls onFrame and does not re-render", async () => {
  const listeners = new Set<(event: MessageEvent) => void>();
  const worker = {
    postMessage() {},
    addEventListener: (_type: string, l: (event: MessageEvent) => void) => void listeners.add(l),
    removeEventListener: (_type: string, l: (event: MessageEvent) => void) => void listeners.delete(l),
    terminate() {},
  } as unknown as InkWorkerLike;
  const canvas = {
    getBoundingClientRect: () => ({ width: 400, height: 300, left: 0, top: 0, right: 400, bottom: 300 }),
  } as unknown as HTMLCanvasElement;
  const frames: number[] = [];
  let renders = 0;
  function Host() {
    renders += 1;
    usePenCapture({
      element: () => canvas,
      project: (x, y) => ({ x, y }),
      pageIndex: 0,
      tool: "pen",
      width: 2,
      colour: "text",
      penOnlyStorage: null,
      createWorker: () => worker,
      transferCanvas: () => ({}) as OffscreenCanvas,
      onFrame: (frame) => frames.push(frame),
    });
    return null;
  }
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(createElement(Host));
  });
  assert.ok(listeners.size > 0, "the worker is listened to");
  const before = renders;
  await act(async () => {
    for (let frame = 1; frame <= 5; frame++) {
      for (const l of [...listeners]) l({ data: { type: "frame", frame, strokeId: 0 } } as MessageEvent);
    }
  });
  assert.deepEqual(frames, [1, 2, 3, 4, 5]);
  assert.equal(renders, before, "frames are not React state");
  act(() => root.unmount());
});
