// Freehand (Excalidraw freedraw / perfect-freehand) is the only ink renderer:
// no classic capsule path, no renderer knob, and the shape knobs always apply.
import { test } from "node:test";
import assert from "node:assert/strict";

import { InkPageBuffer } from "../application/parts-3";
import { DEFAULT_INK_TUNING, parseInkTuning } from "../application/ink-tuning";
import * as canvasRendererModule from "../render/canvas-renderer";
import { CanvasInkRenderer, type Canvas2dLike, type Context2dLike } from "../render/canvas-renderer";
import { DEFAULT_FREEDRAW_SHAPE, type FreedrawShape } from "../render/excalidraw-freedraw";
import * as freehandModule from "../render/freehand-stroke";
import { newLiveStroke, type LiveStroke } from "../worker/live-stroke";
import { typedCore } from "@/lib/rust-core";

test("there is one renderer: no renderer kind, setting or capsule painter is exported", () => {
  for (const name of ["INK_RENDERERS", "DEFAULT_INK_RENDERER", "parseInkRenderer", "parseInkABOn"]) {
    assert.equal(name in freehandModule, false, `${name} is gone`);
  }
  assert.equal("paintStroke" in canvasRendererModule, false, "the classic capsule painter is gone");
});

test("ink.tuning has no renderer or backend knobs", () => {
  for (const key of ["renderer", "forceBackend", "wetDesynchronized"]) {
    assert.equal(key in DEFAULT_INK_TUNING, false, `${key} is not a knob`);
  }
});

test("an old settings file that still names a renderer loads, and the key is dropped", () => {
  const tuning = parseInkTuning({ renderer: "classic", forceBackend: "2d", wetDesynchronized: false, thinning: 0.3 });
  assert.equal(tuning.thinning, 0.3);
  for (const key of ["renderer", "forceBackend", "wetDesynchronized"]) {
    assert.equal(key in tuning, false, `${key} is dropped`);
  }
});

test("a live stroke keeps raw samples only: no packer, no renderer flag", () => {
  const header = { strokeId: 1, width: 4, tool: "pen", colour: "text" } as unknown as LiveStroke["header"];
  const stroke = newLiveStroke(header);
  assert.equal("packer" in stroke, false);
  assert.equal("raw" in stroke, false);
});

/** A 2D context that records each call's name and arguments. */
function recordingCanvas(): { canvas: Canvas2dLike; calls: { name: string; args: unknown[] }[] } {
  const calls: { name: string; args: unknown[] }[] = [];
  const context = new Proxy({} as Record<string, unknown>, {
    get(_target, name) {
      return (...args: unknown[]) => {
        calls.push({ name: String(name), args });
      };
    },
    set() {
      return true;
    },
  }) as unknown as Context2dLike;
  return { canvas: { width: 0, height: 0, getContext: () => context }, calls };
}

function penPage() {
  const model = typedCore().blankInkPage("blank");
  model.strokes = [
    typedCore().makeInkStroke({
      points: [10, 10, 60, 40, 120, 20, 180, 60, 240, 30, 300, 70],
      pressures: [60, 200, 120, 240, 90, 180],
      width: 8,
      tool: "pen",
      colour: "text",
    }),
  ];
  return model;
}

test("the renderer always fills the freehand outline, and the shape knobs change it", () => {
  let shape: FreedrawShape = { ...DEFAULT_FREEDRAW_SHAPE };
  const { canvas, calls } = recordingCanvas();
  const renderer = new CanvasInkRenderer({ canvas, shape: () => shape });
  renderer.setStrokes(new InkPageBuffer(penPage()).allStrokes());
  renderer.draw();
  assert.ok(calls.some((c) => c.name === "quadraticCurveTo"), "the freedraw outline is drawn");
  assert.ok(!calls.some((c) => c.name === "arc"), "no capsule caps are drawn");
  const outline = () => JSON.stringify(calls.filter((c) => c.name === "quadraticCurveTo").map((c) => c.args));
  const before = outline();

  calls.length = 0;
  shape = { ...DEFAULT_FREEDRAW_SHAPE, taperEnd: 40, thinning: 0.1 };
  renderer.draw();
  assert.notEqual(outline(), before, "a shape knob change redraws the outline");
});
