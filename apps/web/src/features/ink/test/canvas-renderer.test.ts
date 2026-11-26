/**
 * The Canvas 2D fallback, against a recording context: what matters is that it
 * honours the renderer contract (index-stable strokes, pen-then-highlighter
 * order, one fill per stroke) and that `capture` paints paper under the ink.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { INK_A4_HEIGHT, INK_A4_WIDTH } from "@weaveforge/core";

import { InkPageBuffer } from "../application/parts-3";
import {
  CanvasInkRenderer,
  HIGHLIGHTER_ALPHA,
  cssInkColour,
  paintFreehandStroke,
  type Canvas2dLike,
  type Context2dLike,
} from "../render/canvas-renderer";
import { typedCore } from "@/lib/rust-core";

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
  const model = typedCore().blankInkPage("blank");
  model.strokes = tools.map((tool, i) =>
    typedCore().makeInkStroke({
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

test("undoing the delete of a middle stroke paints it back under the later ones", () => {
  const colours = ["text", "warn", "good"] as const;
  const model = page(["pen", "pen", "pen"]);
  model.strokes = model.strokes.map((stroke, i) => ({ ...stroke, colour: colours[i]! }));
  const buffer = new InkPageBuffer(model);
  const fillsOf = (act: (renderer: CanvasInkRenderer) => void): string[] => {
    const { canvas, fills } = recordingCanvas();
    const renderer = new CanvasInkRenderer({ canvas });
    renderer.setPage({ width: INK_A4_WIDTH, height: INK_A4_HEIGHT }, "blank");
    renderer.setStrokes(buffer.allStrokes());
    act(renderer);
    fills.length = 0;
    renderer.draw();
    return [...fills];
  };
  const fresh = fillsOf(() => {});
  assert.equal(new Set(fresh).size, 3, "three distinct fills to compare");
  const undone = fillsOf((renderer) => {
    renderer.removeStroke(1);
    renderer.appendStroke(buffer.stroke(1)!, 1);
  });
  assert.deepEqual(undone, fresh);
  // Re-appending an index that is already there replaces it; it is not painted twice.
  assert.deepEqual(fillsOf((renderer) => renderer.appendStroke(buffer.stroke(0)!, 0)), fresh);
});

test("on screen it leaves strokes the page's SVG already shows to the SVG", () => {
  const { canvas, fills } = recordingCanvas();
  const renderer = new CanvasInkRenderer({ canvas });
  const buffer = new InkPageBuffer(page(["pen", "pen"]));
  renderer.setStrokes(buffer.allStrokes());
  renderer.setShown(1);
  renderer.draw();
  // Stroke 0 is drawn by the sheet's SVG; only the unacknowledged one is wet.
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

test("freehand paints a stroke as one closed outline fill, never a stroked path", () => {
  const { canvas, calls, fills } = recordingCanvas();
  const context = canvas.getContext("2d") as Context2dLike;
  const x = Float32Array.from([10, 20, 30, 40, 50, 60]);
  const y = Float32Array.from([10, 30, 10, 30, 10, 30]);
  const pressure = Uint8Array.from([200, 200, 200, 200, 200, 200]);
  const drawn = paintFreehandStroke(
    context,
    x,
    y,
    pressure,
    { width: 6, tool: "pen", colour: "text" },
    false,
  );
  assert.equal(drawn, x.length - 1);
  assert.equal(calls.filter((c) => c.name === "fill").length, 1);
  assert.equal(calls.filter((c) => c.name === "stroke").length, 0);
  assert.ok(calls.some((c) => c.name === "closePath"));
  assert.equal(fills.length, 1);
});

test("the renderer paints each stroke as a closed freehand outline, no capsule arcs", () => {
  const { canvas, calls } = recordingCanvas();
  const renderer = new CanvasInkRenderer({ canvas });
  renderer.setStrokes(new InkPageBuffer(page(["pen"])).allStrokes());
  renderer.draw();
  assert.ok(calls.some((c) => c.name === "closePath"), "the outline is closed");
  assert.ok(calls.some((c) => c.name === "fill" || c.name === "quadraticCurveTo"), "the outline is filled");
  assert.ok(!calls.some((c) => c.name === "arc"), "no capsule caps are drawn");
});

test("freehand reuses a stroke's outline until the stroke is replaced, then sees moved points", () => {
  const { canvas, calls } = recordingCanvas();
  const renderer = new CanvasInkRenderer({ canvas });
  const strokes = new InkPageBuffer(page(["pen"])).allStrokes();
  renderer.setStrokes(strokes);
  const starts = () => calls.filter((c) => c.name === "moveTo").map((c) => c.args[0] as number);
  renderer.draw();
  renderer.draw();
  const [first, second] = starts();
  assert.equal(first, second, "an unchanged stroke draws the same outline");

  // A moved selection edits the points in place, then replaces the stroke.
  const geometry = strokes[0]!;
  for (let i = 0; i < geometry.x.length; i += 1) geometry.x[i] = geometry.x[i]! + 100;
  renderer.removeStroke(0);
  renderer.appendStroke(geometry, 0);
  calls.length = 0;
  renderer.draw();
  assert.ok(Math.abs(starts()[0]! - (first! + 100)) < 1, "the moved stroke is drawn where it now is");
});
