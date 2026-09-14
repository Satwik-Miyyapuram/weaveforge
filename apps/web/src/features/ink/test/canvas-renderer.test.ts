/**
 * The Canvas 2D fallback, against a recording context: what matters is that it
 * honours the renderer contract (index-stable strokes, pen-then-highlighter
 * order, one fill per stroke) and that `capture` paints paper under the ink.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  blankInkPage,
  makeInkStroke,
} from "@weaveforge/core";

import { InkPageBuffer } from "../application/page-buffer";
import {
  CanvasInkRenderer,
  HIGHLIGHTER_ALPHA,
  cssInkColour,
  type Canvas2dLike,
  type Context2dLike,
} from "../render/canvas-renderer";

interface Call {
  name: string;
  args: unknown[];
}

/** A 2D context that records what was asked of it. */
function recordingCanvas(): {
  canvas: Canvas2dLike;
  calls: Call[];
  fills: string[];
} {
  const calls: Call[] = [];
  const fills: string[] = [];
  let fillStyle = "";
  const context = new Proxy({} as Record<string, unknown>, {
    get(_target, name) {
      if (name === "fillStyle") return fillStyle;
      return (...args: unknown[]) => {
        calls.push({ name: String(name), args });
        if (name === "fill") fills.push(fillStyle);
      };
    },
    set(_target, name, value) {
      if (name === "fillStyle") fillStyle = String(value);
      return true;
    },
  }) as unknown as Context2dLike;
  const canvas: Canvas2dLike = {
    width: 0,
    height: 0,
    getContext: () => context,
    convertToBlob: async () => new Blob(["png"], { type: "image/png" }),
  };
  return { canvas, calls, fills };
}

function page(tools: ("pen" | "highlighter")[]) {
  const model = blankInkPage("blank");
  model.strokes = tools.map((tool, i) =>
    makeInkStroke({
      points: [10, 10 + i * 100, 200, 10 + i * 100, 300, 30 + i * 100],
      pressures: [128, 200, 100],
      width: 6,
      tool,
      colour: tool === "highlighter" ? "accent" : "text",
    }),
  );
  return model;
}

test("it draws highlighters over pen strokes, one fill each, and the live stroke last", () => {
  const { canvas, calls, fills } = recordingCanvas();
  const renderer = new CanvasInkRenderer({ canvas });
  const buffer = new InkPageBuffer(page(["highlighter", "pen"]));
  renderer.setPage({ width: INK_A4_WIDTH, height: INK_A4_HEIGHT }, "blank");
  renderer.resize(400, 600, 2);
  assert.equal(canvas.width, 800);
  renderer.setStrokes(buffer.allStrokes());
  renderer.draw();
  // The pen's opaque fill lands first, then the translucent highlighter over
  // it — the fill order is the paint order on a canvas.
  assert.deepEqual(fills, [
    cssInkColour("text"),
    cssInkColour("accent", HIGHLIGHTER_ALPHA),
  ]);
  assert.ok(
    calls.some((call) => call.name === "clearRect"),
    "a live draw clears rather than paints white",
  );
  assert.equal(renderer.renderStats.strokes, 2);
  assert.equal(renderer.renderStats.drawn, 4);
});

test("strokes are addressed by buffer index across erase and restore", () => {
  const { canvas, fills } = recordingCanvas();
  const renderer = new CanvasInkRenderer({ canvas });
  const buffer = new InkPageBuffer(page(["pen", "pen", "pen"]));
  renderer.setStrokes(buffer.allStrokes());
  renderer.removeStroke(1);
  assert.equal(renderer.renderStats.strokes, 2);
  renderer.appendStroke(buffer.stroke(1)!, 1);
  assert.equal(renderer.renderStats.strokes, 3);
  renderer.removeStroke(7); // not there: a no-op, not a throw
  renderer.setStrokes([null, buffer.stroke(1), null]);
  renderer.draw();
  assert.equal(fills.length, 1);
});

test("capture paints white and the paper under the ink into a fresh canvas", async () => {
  const { canvas } = recordingCanvas();
  const target = recordingCanvas();
  const renderer = new CanvasInkRenderer({
    canvas,
    createCanvas: () => target.canvas,
  });
  renderer.setPage({ width: 1000, height: 500 }, "ruled");
  renderer.setStrokes(new InkPageBuffer(page(["pen"])).allStrokes());
  const blob = await renderer.capture(0.5);
  assert.ok(blob);
  assert.equal(blob.type, "image/png");
  const names = target.calls.map((call) => call.name);
  assert.equal(names[1], "fillRect", "the export is opaque");
  assert.ok(
    names.filter((name) => name === "stroke").length >= 5,
    "the rulings were drawn",
  );
  assert.ok(names.includes("fill"), "and the ink over them");
});

test("it refuses a canvas with no 2D context", () => {
  assert.throws(
    () =>
      new CanvasInkRenderer({
        canvas: { width: 0, height: 0, getContext: () => null },
      }),
    /Canvas 2D is unavailable/,
  );
});
