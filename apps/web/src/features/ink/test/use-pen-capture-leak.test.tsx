/**
 * Opening and closing ink pages leaves nothing behind.
 *
 * Each page holds a worker, its message listeners and (while hidden) a
 * ResizeObserver. A page that is closed must give all of them back, or a long
 * session grows with every tab opened. The heap check runs after forced GCs
 * with wide headroom so it only trips on a per-page leak, not on noise.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { usePenCapture, type InkWorkerLike } from "../application/use-pen-capture";
import type { InkWorkerMessage } from "../application/capture-protocol";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { window?: unknown }).window ??= {
  requestAnimationFrame: () => 0,
  cancelAnimationFrame() {},
  devicePixelRatio: 1,
};

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

const live = { workers: 0, listeners: 0, observers: 0 };

class CountingObserver {
  constructor(private readonly cb: () => void) {}
  observe() {
    live.observers += 1;
  }
  disconnect() {
    live.observers -= 1;
  }
  fire() {
    this.cb();
  }
}

/** A worker that answers `dispose` with `disposed`, as the real one does. */
function countingWorker(): InkWorkerLike {
  const listeners = new Set<(event: MessageEvent) => void>();
  live.workers += 1;
  return {
    postMessage(message: InkWorkerMessage) {
      if (message.type !== "dispose") return;
      queueMicrotask(() => {
        for (const l of [...listeners]) l({ data: { type: "disposed" } } as MessageEvent);
      });
    },
    addEventListener(_type: string, l: (event: MessageEvent) => void) {
      if (!listeners.has(l)) live.listeners += 1;
      listeners.add(l);
    },
    removeEventListener(_type: string, l: (event: MessageEvent) => void) {
      if (listeners.delete(l)) live.listeners -= 1;
    },
    terminate() {
      live.workers -= 1;
      live.listeners -= listeners.size;
      listeners.clear();
    },
  } as InkWorkerLike;
}

async function openAndClose(visible: boolean) {
  const box = visible ? { width: 400, height: 300 } : { width: 0, height: 0 };
  const canvas = {
    getBoundingClientRect: () => ({ ...box, left: 0, top: 0, right: box.width, bottom: box.height }),
  } as unknown as HTMLCanvasElement;
  function Host() {
    usePenCapture({
      element: () => canvas,
      project: (x, y) => ({ x, y }),
      pageIndex: 0,
      tool: "pen",
      width: 2,
      colour: "text",
      penOnlyStorage: null,
      createWorker: countingWorker,
      transferCanvas: () => ({}) as OffscreenCanvas,
    });
    return null;
  }
  let root!: ReturnType<typeof create>;
  act(() => {
    root = create(createElement(Host));
  });
  act(() => root.unmount());
  // Let the worker's `disposed` reply land.
  await new Promise((r) => setImmediate(r));
}

async function cycles(n: number) {
  for (let i = 0; i < n; i += 1) await openAndClose(i % 2 === 0);
}

function settledHeap(): number {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
}

test("closing visible and hidden ink pages frees workers, listeners and observers", async () => {
  const g = globalThis as { ResizeObserver?: unknown };
  const before = g.ResizeObserver;
  g.ResizeObserver = CountingObserver;
  try {
    await cycles(20);
    assert.deepEqual(live, { workers: 0, listeners: 0, observers: 0 });
  } finally {
    g.ResizeObserver = before;
  }
});

test("a thousand open/close cycles do not grow the heap", async () => {
  const g = globalThis as { ResizeObserver?: unknown };
  const before = g.ResizeObserver;
  g.ResizeObserver = CountingObserver;
  try {
    await cycles(100); // warm up: JIT, React internals, module caches
    const start = settledHeap();
    await cycles(1000);
    const grown = (settledHeap() - start) / 1048576;
    console.log(`heap growth over 1000 cycles: ${grown.toFixed(2)} MB`);
    // A leak of 5 KB per page (one hook closure graph) is 5 MB here.
    assert.ok(grown < 5, `heap grew ${grown.toFixed(2)} MB`);
    assert.deepEqual(live, { workers: 0, listeners: 0, observers: 0 });
  } finally {
    g.ResizeObserver = before;
  }
});
