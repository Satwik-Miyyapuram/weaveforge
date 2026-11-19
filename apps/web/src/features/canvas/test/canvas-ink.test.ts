import { test } from "node:test";
import assert from "node:assert/strict";

import type { InkPoint, InkStroke } from "../application/freeform-ink";
import { canvasStrokePath, pathFor, strokeClass } from "../ui/canvas-ink";
import { getFreeDrawSvgPath } from "../../ink/render/excalidraw-freedraw";

const pen: InkStroke = { id: "s1", x: 0, y: 0, w: 2, c: "#000000", t: "pen", p: [0, 0] };

test("a highlighter stroke is drawn translucent; a pen stroke is not", () => {
  assert.equal(strokeClass(pen, false), "canvas-ink__stroke");
  assert.equal(strokeClass({ ...pen, t: "highlighter" }, false), "canvas-ink__stroke canvas-ink__stroke--highlighter");
});

test("a selected stroke is marked whatever its tool", () => {
  assert.equal(strokeClass(pen, true), "canvas-ink__stroke canvas-ink__stroke--selected");
  assert.equal(
    strokeClass({ ...pen, t: "highlighter" }, true),
    "canvas-ink__stroke canvas-ink__stroke--highlighter canvas-ink__stroke--selected",
  );
});

function circle(n: number, radius: number, jitter = 0): InkPoint[] {
  const out: InkPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = radius + (jitter ? jitter * Math.sin(i * 7.3) : 0);
    out.push({ x: 100 + Math.cos(a) * r, y: 100 + Math.sin(a) * r, pressure: 0.5 });
  }
  return out;
}

test("classic keeps the polyline exactly", () => {
  const pts = circle(60, 40);
  assert.equal(canvasStrokePath(pts, 2, "pen", "classic"), pathFor(pts));
});

/** Excalidraw's freedraw path for the same points, as the wiring must produce. */
function excalidrawPath(pts: InkPoint[], width: number): string {
  const simulate = Math.abs((pts[0]?.pressure ?? 0.5) - 0.5) <= 1 / 255;
  return getFreeDrawSvgPath({
    points: pts.map((p) => [p.x, p.y]),
    pressures: pts.map((p) => p.pressure),
    strokeWidth: width,
    simulatePressure: simulate,
    lastCommittedPoint: [0, 0],
  });
}

test("freehand is Excalidraw's freedraw path for the same points (2 px and 4 px)", () => {
  const pts = circle(30, 40);
  assert.equal(canvasStrokePath(pts, 2, "pen", "freehand"), excalidrawPath(pts, 2));
  assert.equal(canvasStrokePath(pts, 4, "pen", "freehand"), excalidrawPath(pts, 4));
});

test("freehand uses real pen pressure when the first point is not the mouse midpoint", () => {
  const pts = circle(30, 40).map((p, i) => ({ ...p, pressure: 0.2 + (i / 30) * 0.6 }));
  assert.equal(canvasStrokePath(pts, 8, "pen", "freehand"), excalidrawPath(pts, 8));
});

test("freehand closes with one straight segment (Excalidraw's Z) and draws curves", () => {
  for (const spacing of [60, 20]) {
    const d = canvasStrokePath(circle(spacing, 40), 2, "pen", "freehand");
    assert.match(d, /^M/);
    assert.match(d, /Q/);
    assert.equal(d.match(/ L /g)?.length, 1, "only the closing L");
    assert.doesNotMatch(d, /NaN|Infinity/);
  }
});

test("freehand sparse and jittered input still draws curves, not facets", () => {
  for (const pts of [circle(14, 40), circle(120, 40, 0.8)]) {
    const d = canvasStrokePath(pts, 2, "pen", "freehand");
    assert.equal(d.match(/ L /g)?.length, 1, "no facet: only the closing L");
    assert.doesNotMatch(d, /NaN/);
  }
});

test("wet and settled use the same path for the same points", () => {
  const pts = circle(30, 40);
  assert.equal(
    canvasStrokePath(pts, 2, "pen", "freehand"),
    canvasStrokePath([...pts], 2, "pen", "freehand"),
  );
});

test("the path function leaves the stored points untouched", () => {
  const pts = circle(30, 40);
  const before = JSON.stringify(pts);
  canvasStrokePath(pts, 2, "pen", "freehand");
  assert.equal(JSON.stringify(pts), before);
});

test("a single point is a dot in both renderers", () => {
  const one = [{ x: 5, y: 6, pressure: 0.5 }];
  assert.equal(canvasStrokePath(one, 2, "pen", "freehand"), pathFor(one));
});

test("a highlighter and a pen share one outline; only the CSS opacity differs", () => {
  const pts = circle(30, 40);
  assert.equal(
    canvasStrokePath(pts, 2, "highlighter", "freehand"),
    canvasStrokePath(pts, 2, "pen", "freehand"),
  );
});
