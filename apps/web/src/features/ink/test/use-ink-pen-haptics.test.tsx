/**
 * The pen asks for its haptics once per mount, even though the host hands it
 * a fresh function every render, and the actuator starts on the tool in
 * force when it arrives (21-02).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { PenHaptics, PenHapticsTool } from "../application/pen-haptics";
import { useInkPen, type InkPenDeps } from "../ui/use-ink-pen";
import { INK_RENDER_COLOURS } from "../render/ink-palette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { window?: unknown }).window ??= { requestAnimationFrame: () => 0, cancelAnimationFrame() {} };

function fakeHaptics() {
  const tools: PenHapticsTool[] = [];
  let stops = 0;
  const h: PenHaptics = { setTool: (t) => void tools.push(t), update() {}, stop: () => void stops++ };
  return { h, tools, stops: () => stops };
}

function deps(tool: InkPenDeps["tool"], haptics: InkPenDeps["haptics"]): InkPenDeps {
  return {
    canvasRef: { current: null },
    sheetRef: { current: null },
    project: (x, y) => ({ x, y }),
    pageIndex: 0,
    tool,
    width: 2,
    colour: "text" as never,
    hand: "right",
    palette: INK_RENDER_COLOURS,
    onEvent() {},
    onStrokeEnd() {},
    haptics,
  };
}

function Host(props: { deps: InkPenDeps }) {
  useInkPen(props.deps);
  return null;
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

test("a fresh haptics function each render acquires once", async () => {
  const fake = fakeHaptics();
  let asks = 0;
  const source = { haptics: async () => { asks++; return fake.h; } };
  let r!: ReactTestRenderer;
  act(() => {
    r = create(createElement(Host, { deps: deps("pen", source.haptics.bind(source)) }));
  });
  await flush();
  for (let i = 0; i < 3; i++) {
    act(() => r.update(createElement(Host, { deps: deps("pen", source.haptics.bind(source)) })));
    await flush();
  }
  assert.equal(asks, 1);
  assert.equal(fake.stops(), 0);
  act(() => r.unmount());
  assert.equal(fake.stops(), 1);
});

test("haptics that arrive late start on the tool in force", async () => {
  const fake = fakeHaptics();
  let resolve!: (h: PenHaptics) => void;
  const pending = new Promise<PenHaptics>((r) => (resolve = r));
  let r!: ReactTestRenderer;
  act(() => {
    r = create(createElement(Host, { deps: deps("pen", () => pending) }));
  });
  act(() => r.update(createElement(Host, { deps: deps("highlighter", () => pending) })));
  resolve(fake.h);
  await flush();
  assert.equal(fake.tools.at(-1), "highlighter");
  act(() => r.update(createElement(Host, { deps: deps("eraser", () => pending) })));
  assert.equal(fake.tools.at(-1), "eraser");
  act(() => r.unmount());
});

test("haptics that arrive after unmount are never used", async () => {
  const fake = fakeHaptics();
  let resolve!: (h: PenHaptics) => void;
  const pending = new Promise<PenHaptics>((r) => (resolve = r));
  let r!: ReactTestRenderer;
  act(() => {
    r = create(createElement(Host, { deps: deps("pen", () => pending) }));
  });
  act(() => r.unmount());
  resolve(fake.h);
  await flush();
  assert.deepEqual(fake.tools, []);
});

test("no haptics on this platform is fine", async () => {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(createElement(Host, { deps: deps("pen", undefined) }));
  });
  act(() => r.update(createElement(Host, { deps: deps("eraser", async () => null) })));
  await flush();
  act(() => r.unmount());
});
