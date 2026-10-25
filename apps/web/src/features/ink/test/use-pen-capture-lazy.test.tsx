/**
 * A hidden ink page starts no worker until it is shown.
 *
 * The workspace keeps every open tab mounted (pane-view.tsx), so a restored
 * workspace with six ink tabs used to start six workers and six WebGL contexts
 * for pages nobody was looking at: about 7.5 MB each, measured in Dev. The
 * worker now starts when the canvas first has a box; once started it stays,
 * because it holds the page's committed geometry and undo history.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import {
  usePenCapture,
  type InkWorkerLike,
  type PenCaptureHandle,
} from "../application/use-pen-capture";
import type { InkWorkerMessage } from "../application/capture-protocol";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { window?: unknown }).window ??= {
  requestAnimationFrame: () => 0,
  cancelAnimationFrame() {},
  devicePixelRatio: 1,
};

/** A ResizeObserver the test fires by hand. */
const observers = new Set<FakeObserver>();
class FakeObserver {
  targets = new Set<unknown>();
  constructor(private readonly cb: () => void) {
    observers.add(this);
  }
  observe(target: unknown) {
    this.targets.add(target);
  }
  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }
  fire() {
    this.cb();
  }
}
function fireResize() {
  for (const o of [...observers]) o.fire();
}

function fakeCanvas(box: { width: number; height: number }) {
  return {
    getBoundingClientRect: () => ({ ...box, left: 0, top: 0, right: box.width, bottom: box.height }),
  } as unknown as HTMLCanvasElement;
}

function fakeWorker(log: InkWorkerMessage[]): InkWorkerLike {
  return {
    postMessage: (m) => void log.push(m),
    addEventListener() {},
    removeEventListener() {},
    terminate() {},
  };
}

function mount(canvas: HTMLCanvasElement) {
  const sent: InkWorkerMessage[] = [];
  let created = 0;
  let handle!: PenCaptureHandle;
  function Host() {
    handle = usePenCapture({
      element: () => canvas,
      project: (x, y) => ({ x, y }),
      pageIndex: 0,
      tool: "pen",
      width: 2,
      colour: "text",
      penOnlyStorage: null,
      createWorker: () => {
        created += 1;
        return fakeWorker(sent);
      },
      transferCanvas: () => ({}) as OffscreenCanvas,
    });
    return null;
  }
  let root!: ReactTestRenderer;
  act(() => {
    root = create(createElement(Host));
  });
  return { root, sent, created: () => created, handle: () => handle };
}

function withObserver(run: () => void) {
  const g = globalThis as { ResizeObserver?: unknown };
  const before = g.ResizeObserver;
  g.ResizeObserver = FakeObserver;
  observers.clear();
  try {
    run();
  } finally {
    g.ResizeObserver = before;
  }
}

test("a visible ink page starts its worker at mount", () => {
  withObserver(() => {
    const { root, created, sent } = mount(fakeCanvas({ width: 400, height: 300 }));
    assert.equal(created(), 1);
    assert.equal(sent[0]?.type, "init");
    assert.equal(observers.size, 0, "nothing to wait for");
    act(() => root.unmount());
  });
});

test("a hidden ink page waits for a box, then starts once at that size", () => {
  withObserver(() => {
    const box = { width: 0, height: 0 };
    const { root, created, sent, handle } = mount(fakeCanvas(box));
    assert.equal(created(), 0, "no worker for a page nobody sees");

    // What the host says while hidden is kept, in order, for the worker.
    act(() => handle().send({ type: "dispose" } as InkWorkerMessage));
    fireResize();
    assert.equal(created(), 0, "a resize that leaves it hidden starts nothing");

    box.width = 400;
    box.height = 300;
    act(() => fireResize());
    assert.equal(created(), 1);
    const init = sent[0] as Extract<InkWorkerMessage, { type: "init" }>;
    assert.equal(init.type, "init");
    assert.equal(init.width, 400);
    assert.equal(init.height, 300);
    assert.equal(sent[1]?.type, "dispose", "the queued message follows init");
    assert.equal(observers.size, 0, "the observer is gone once the worker runs");

    // Hidden again: the worker keeps its page and undo history.
    box.width = 0;
    box.height = 0;
    act(() => fireResize());
    assert.equal(created(), 1);
    act(() => root.unmount());
  });
});

test("a hidden ink page closed before it was shown never starts a worker", () => {
  withObserver(() => {
    const { root, created } = mount(fakeCanvas({ width: 0, height: 0 }));
    act(() => root.unmount());
    assert.equal(observers.size, 0, "the observer is disconnected");
    act(() => fireResize());
    assert.equal(created(), 0);
  });
});

test("without ResizeObserver a hidden page starts at once, as before", () => {
  const g = globalThis as { ResizeObserver?: unknown };
  const before = g.ResizeObserver;
  delete g.ResizeObserver;
  try {
    const { root, created } = mount(fakeCanvas({ width: 0, height: 0 }));
    assert.equal(created(), 1);
    act(() => root.unmount());
  } finally {
    g.ResizeObserver = before;
  }
});
