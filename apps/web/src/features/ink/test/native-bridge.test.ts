/**
 * The native bridge: a shell's flat stroke becomes the session's events, and
 * without a shell there is no bridge at all.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  nativeInkBridge,
  nativeStrokeEvents,
} from "../application/native-bridge";

test("a flat native stroke becomes pen events in CSS pixels", () => {
  const events = nativeStrokeEvents([200, 400, 0.5, 10, 220, 420, 0.7, 18], 2);
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((e) => [e.clientX, e.clientY, e.pressure, e.t]),
    [
      [100, 200, 0.5, 10],
      [110, 210, 0.7, 18],
    ],
  );
  assert.ok(events.every((e) => e.pointerType === "pen"));
  assert.ok(events.every((e) => e.pointerId === events[0]!.pointerId));
});

test("a trailing partial point is dropped, and a bad pressure is mid-range", () => {
  const events = nativeStrokeEvents([1, 2, Number.NaN, 3, 9, 9], 1);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.pressure, 0.5);
});

test("without a shell there is no bridge", () => {
  assert.equal(nativeInkBridge(), null);
});

test("the shell gets each tool colour as #AARRGGBB from the palette (18-09)", () => {
  const sent: [string, number][] = [];
  const noop = () => {};
  const w = globalThis as unknown as { window?: Record<string, unknown> };
  const hadWindow = "window" in globalThis;
  const previous = w.window;
  w.window = {
    ...(previous ?? {}),
    AndroidInkingBridge: {
      setTool: (argb: string, width: number) => sent.push([argb, width]),
      setViewport: noop,
      clearViewport: noop,
      setPenOnly: noop,
      setHandedness: noop,
      clearOverlay: noop,
    },
  };
  try {
    const bridge = nativeInkBridge();
    assert.ok(bridge);
    bridge.setTool({ tool: "pen", colour: "text", widthPx: 2 });
    bridge.setTool({ tool: "highlighter", colour: "yellow", widthPx: 8 });
    bridge.setTool({ tool: "pen", colour: "nope" as never, widthPx: 1 });
    assert.deepEqual(sent, [
      ["#ff212429", 2],
      ["#59ffd400", 8],
      ["#ff212429", 1],
    ]);
  } finally {
    if (hadWindow) w.window = previous;
    else delete w.window;
  }
});
