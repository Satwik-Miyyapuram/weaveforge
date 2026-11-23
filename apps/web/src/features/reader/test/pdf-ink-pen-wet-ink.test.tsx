/**
 * A PDF stroke does not jump at either end ("it is jumping before and after
 * pen down"), now that the notes' pen draws it (`PdfInkPen`).
 *
 * The no-lift rule: what is saved is the stroke the worker drew wet, end to
 * end. Nothing is added at the lift, so the saved mark starts where the wet
 * ink started and ends where it ended, and the wet ink stays on screen until
 * the save has landed.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { draftInkAnnotation } from "@weaveforge/wasm";

import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { INK_RENDER_COLOURS } from "@/features/ink/render/parts-1";
import type { InkWorkerEvent } from "@/features/ink/application/capture-protocol";
import { PEN_UNITS_PER_PT } from "../application/pdf-ink-pen";
import { PdfInkPen, type PdfInkPenProps } from "../ui/pdf-reader/pdf-ink-pen";

before(loadTestCore);

// The component's JSX compiles to React.createElement under the test loader.
Object.assign(globalThis, { React });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The pen's worker: what it was sent, and a way to answer as it would. */
class FakeWorker {
  static last: FakeWorker | null = null;
  sent: { type: string }[] = [];
  private listeners: ((e: { data: InkWorkerEvent }) => void)[] = [];
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: { type: string }) {
    this.sent.push(message);
  }
  addEventListener(_: string, f: (e: { data: InkWorkerEvent }) => void) {
    this.listeners.push(f);
  }
  removeEventListener(_: string, f: (e: { data: InkWorkerEvent }) => void) {
    this.listeners = this.listeners.filter((g) => g !== f);
  }
  terminate() {}
  answer(data: InkWorkerEvent) {
    for (const f of this.listeners) f({ data });
  }
  loads() {
    return this.sent.filter((m) => m.type === "load-page").length;
  }
}

const g = globalThis as unknown as {
  window?: unknown;
  Worker?: unknown;
  requestAnimationFrame?: unknown;
  cancelAnimationFrame?: unknown;
};
const previous = { window: g.window, Worker: g.Worker, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
before(() => {
  g.window ??= globalThis;
  g.Worker = FakeWorker;
  g.requestAnimationFrame = (f: () => void) => setTimeout(f, 0);
  g.cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
});
after(() => {
  g.window = previous.window;
  g.Worker = previous.Worker;
  g.requestAnimationFrame = previous.raf;
  g.cancelAnimationFrame = previous.caf;
});

const box = { left: 0, top: 0, right: 600, bottom: 800, width: 600, height: 800, x: 0, y: 0 };
const projection = { pageWidth: 600, pageHeight: 800, scale: 1, rotation: 0 };
const toPdf = (x: number, y: number) => readyCore().screenPointToPdf(x, y, projection);

type Save = Parameters<PdfInkPenProps["persistInkStroke"]>[0];

function props(persistInkStroke: (input: Save) => Promise<boolean>): PdfInkPenProps {
  return {
    pageNumber: 1,
    scale: 1,
    projection,
    pageHeight: 800,
    tool: "pen",
    width: 5,
    highlighterWidth: 60,
    colour: "text" as never,
    palette: INK_RENDER_COLOURS,
    nibPoints: 1.42,
    persistInkStroke,
    registerCancel: () => () => {},
  };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });

async function mount(p: PdfInkPenProps): Promise<{ renderer: ReactTestRenderer; worker: FakeWorker }> {
  FakeWorker.last = null;
  const page = { getBoundingClientRect: () => box };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(PdfInkPen, p), {
      createNodeMock: (el) =>
        el.type === "canvas"
          ? {
              getBoundingClientRect: () => box,
              transferControlToOffscreen: () => {
                throw new Error("no offscreen in node");
              },
              addEventListener() {},
              removeEventListener() {},
              style: {},
            }
          : { parentElement: { querySelector: () => page }, getBoundingClientRect: () => box },
    });
  });
  // The worker starts once the trail presenter has been asked for (a promise).
  await flush();
  assert.ok(FakeWorker.last, "the pen started no worker");
  return { renderer, worker: FakeWorker.last };
}

/** CSS px on the page box as the worker's page units (0.1 mm), as it commits them. */
function wetStroke(css: [number, number][]): InkWorkerEvent {
  const points = new Float32Array(css.length * 2);
  css.forEach(([x, y], i) => {
    points[i * 2] = x * PEN_UNITS_PER_PT;
    points[i * 2 + 1] = y * PEN_UNITS_PER_PT;
  });
  return {
    type: "stroke-committed",
    header: {} as never,
    points,
    pressures: new Uint8Array(css.length).fill(128),
  };
}

/** A fast flick: the wet ink the worker drew ends at (220, 160); the pen lifted further on. */
const flick: [number, number][] = Array.from({ length: 11 }, (_, i) => [100 + 12 * i, 100 + 6 * i]);

test("the saved stroke starts and ends where the wet ink did (no lift point)", async () => {
  const saved: Save[] = [];
  const { renderer, worker } = await mount(props(async (s) => (saved.push(s), true)));
  worker.answer(wetStroke(flick));
  await flush();
  assert.equal(saved.length, 1, "the committed stroke was not saved");
  const path = saved[0]!.path;
  // Every wet point, and nothing after the last: the lift adds no point.
  assert.equal(path.length, flick.length * 2);
  flick.forEach(([x, y], i) => {
    const at = toPdf(x, y);
    assert.ok(Math.hypot(path[i * 2]! - at.x, path[i * 2 + 1]! - at.y) < 1e-3, `point ${i}`);
  });
  // And the stored mark, after compaction, keeps both ends.
  const stored = draftInkAnnotation({ color: "#000", pageIndex: 0, pageHeight: 800, path, width: 1.42 })!
    .anchor.zoteroPosition!.paths![0]!;
  const start = toPdf(...flick[0]!);
  const end = toPdf(...flick.at(-1)!);
  assert.ok(Math.hypot(stored[0]! - start.x, stored[1]! - start.y) < 1e-3, "the saved mark starts elsewhere");
  const n = stored.length;
  assert.ok(Math.hypot(stored[n - 2]! - end.x, stored[n - 1]! - end.y) < 1e-3, "the saved mark ends elsewhere");
  act(() => renderer.unmount());
});

test("the wet ink stays until the saved mark has replaced it", async () => {
  let resolve!: () => void;
  const { renderer, worker } = await mount(props(() => new Promise<boolean>((r) => (resolve = () => r(true)))));
  await flush();
  const before = worker.loads();
  worker.answer(wetStroke(flick));
  await flush();
  assert.equal(worker.loads(), before, "the wet ink was cleared before the save landed");
  resolve();
  await flush();
  assert.equal(worker.loads(), before + 1, "the wet ink outlived the save");
  act(() => renderer.unmount());
});

test("a save that did not land keeps the wet ink on screen", async () => {
  for (const persist of [async () => false, async () => Promise.reject(new Error("disk full"))]) {
    const { renderer, worker } = await mount(props(persist));
    await flush();
    const before = worker.loads();
    worker.answer(wetStroke(flick));
    await flush();
    assert.equal(worker.loads(), before, "the unsaved stroke's wet ink was cleared");
    act(() => renderer.unmount());
  }
});

test("a stroke too short to keep saves nothing", async () => {
  const saved: Save[] = [];
  const { renderer, worker } = await mount(props(async (s) => (saved.push(s), true)));
  worker.answer(wetStroke([[100, 100]]));
  await flush();
  assert.equal(saved.length, 0);
  act(() => renderer.unmount());
});
