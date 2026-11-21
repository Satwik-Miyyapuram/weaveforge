/**
 * A native stroke replays through the pen's session with the tool, colour,
 * width and page in force (P1-1), and is dropped in cursor mode.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { loadTestCore } from "@/lib/test/load-test-core";
import { renderHook } from "@/lib/test/react-harness";
import type { PenCaptureSession } from "../application/use-pen-capture";
import { useInkNativeOverlay, type InkNativeOverlayDeps } from "../ui/use-ink-native-overlay";

before(loadTestCore);

type Win = { window?: Record<string, unknown> };
const g = globalThis as unknown as Win & { requestAnimationFrame?: unknown };
const hadWindow = "window" in globalThis;
const previousWindow = g.window;
const previousRaf = g.requestAnimationFrame;

before(() => {
  const noop = () => {};
  g.window = {
    devicePixelRatio: 1,
    AndroidInkingBridge: {
      setViewport: noop,
      clearViewport: noop,
      setTool: noop,
      setPenOnly: noop,
      setHandedness: noop,
      clearOverlay: noop,
    },
  };
  g.requestAnimationFrame = (f: () => void) => {
    f();
    return 0;
  };
});

after(() => {
  if (hadWindow) g.window = previousWindow;
  else delete g.window;
  g.requestAnimationFrame = previousRaf;
});

function recordingSession(calls: string[], tools: unknown[]): PenCaptureSession {
  return {
    setTool: (t: unknown) => {
      calls.push("setTool");
      tools.push(t);
    },
    pointerDown: () => {
      calls.push("down");
      return { decision: "draw" };
    },
    pointerRawUpdate: () => void calls.push("raw"),
    pointerUp: () => void calls.push("up"),
  } as unknown as PenCaptureSession;
}

function deps(session: PenCaptureSession, cursorMode: boolean): InkNativeOverlayDeps {
  return {
    canvasRef: { current: null },
    scrollRef: { current: null },
    sheetRef: { current: null },
    tool: "pen",
    colour: "red",
    nib: 3,
    palette: undefined as never,
    scale: 1,
    session,
    penOnly: true,
    handedness: "right",
    pageIndex: 2,
    cursorMode,
  };
}

const STROKE = [10, 10, 0.5, 1, 20, 20, 0.5, 9, 30, 30, 0.5, 17];

test("a native stroke sets the session's tool before it replays", async () => {
  const calls: string[] = [];
  const tools: unknown[] = [];
  const h = await renderHook(useInkNativeOverlay, deps(recordingSession(calls, tools), false));
  (g.window!.onNativeStrokeComplete as (p: number[]) => void)(STROKE);
  assert.equal(calls[0], "setTool", `calls: ${calls.join(",")}`);
  assert.ok(calls.includes("down"));
  assert.deepEqual(tools[0], { tool: "pen", colour: "red", width: 3, pageIndex: 2 });
  await h.unmount();
});

test("a native stroke in cursor mode is not drawn", async () => {
  const calls: string[] = [];
  const h = await renderHook(useInkNativeOverlay, deps(recordingSession(calls, []), true));
  (g.window!.onNativeStrokeComplete as (p: number[]) => void)(STROKE);
  assert.ok(!calls.includes("down"), `calls: ${calls.join(",")}`);
  await h.unmount();
});
