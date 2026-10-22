import { test } from "node:test";
import assert from "node:assert/strict";

import { HIGHLIGHTER_ALPHA } from "../render/canvas-renderer";
import type { InkRenderStroke } from "../ui/ink-strokes";
import { drawInkStrokes } from "../ui/ink-page-canvas";

class FakePath2D {
  d: string | undefined;
  constructor(d?: string) {
    this.d = d;
  }
}

globalThis.Path2D = FakePath2D as unknown as typeof Path2D;

interface Call {
  name: string;
  args: unknown[];
}

interface StrokeRecord {
  path: unknown;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
}

function recordingContext(width = 800, height = 1000) {
  const calls: Call[] = [];
  const strokes: StrokeRecord[] = [];
  let strokeStyle = "";
  let lineWidth = 1;
  let globalAlpha = 1;
  let lineCap = "";
  let lineJoin = "";

  const canvas = { width, height };

  const ctx = {
    canvas,
    get strokeStyle() {
      return strokeStyle;
    },
    set strokeStyle(val: string) {
      strokeStyle = val;
    },
    get lineWidth() {
      return lineWidth;
    },
    set lineWidth(val: number) {
      lineWidth = val;
    },
    get globalAlpha() {
      return globalAlpha;
    },
    set globalAlpha(val: number) {
      globalAlpha = val;
    },
    get lineCap() {
      return lineCap;
    },
    set lineCap(val: string) {
      lineCap = val;
    },
    get lineJoin() {
      return lineJoin;
    },
    set lineJoin(val: string) {
      lineJoin = val;
    },
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      calls.push({ name: "setTransform", args: [a, b, c, d, e, f] });
    },
    clearRect(x: number, y: number, w: number, h: number) {
      calls.push({ name: "clearRect", args: [x, y, w, h] });
    },
    stroke(path?: unknown) {
      calls.push({ name: "stroke", args: [path] });
      strokes.push({
        path,
        strokeStyle,
        lineWidth,
        globalAlpha,
      });
    },
  };

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    calls,
    strokes,
  };
}

test("drawInkStrokes draws pens before highlighters regardless of input order", () => {
  const { ctx, strokes } = recordingContext();
  const input: InkRenderStroke[] = [
    {
      points: [0, 0, 10, 10, 20, 20],
      width: 15,
      colour: "#ffff00",
      highlighter: true,
    },
    {
      points: [5, 5, 15, 15, 25, 25],
      width: 2,
      colour: "#000000",
      highlighter: false,
    },
  ];

  drawInkStrokes(ctx, input, 1);

  assert.equal(strokes.length, 2);
  assert.equal(strokes[0]?.strokeStyle, "#000000", "pen drawn first");
  assert.equal(strokes[0]?.lineWidth, 2);
  assert.equal(strokes[1]?.strokeStyle, "#ffff00", "highlighter drawn second");
  assert.equal(strokes[1]?.lineWidth, 15);
});

test("drawInkStrokes sets highlighter globalAlpha to HIGHLIGHTER_ALPHA, pen to 1, and resets globalAlpha to 1 at the end", () => {
  const { ctx, strokes } = recordingContext();
  const input: InkRenderStroke[] = [
    {
      points: [0, 0, 10, 10, 20, 20],
      width: 15,
      colour: "#ffff00",
      highlighter: true,
    },
    {
      points: [5, 5, 15, 15, 25, 25],
      width: 2,
      colour: "#000000",
      highlighter: false,
    },
  ];

  drawInkStrokes(ctx, input, 1);

  assert.equal(strokes[0]?.globalAlpha, 1, "pen alpha is 1");
  assert.equal(strokes[1]?.globalAlpha, HIGHLIGHTER_ALPHA, "highlighter alpha is HIGHLIGHTER_ALPHA");
  assert.equal(ctx.globalAlpha, 1, "globalAlpha reset to 1 at the end");
});

test("drawInkStrokes calls setTransform with unitsToPx scale and sets lineCap/lineJoin to round", () => {
  const { ctx, calls } = recordingContext();
  const input: InkRenderStroke[] = [
    {
      points: [0, 0, 10, 10, 20, 20],
      width: 2,
      colour: "#000000",
      highlighter: false,
    },
  ];

  drawInkStrokes(ctx, input, 2.5);

  const setTransformCall = calls.find((c) => c.name === "setTransform");
  assert.ok(setTransformCall, "setTransform was called");
  assert.deepEqual(setTransformCall.args, [2.5, 0, 0, 2.5, 0, 0]);
  assert.equal(ctx.lineCap, "round");
  assert.equal(ctx.lineJoin, "round");
});
