import { test } from "node:test";
import assert from "node:assert/strict";

import type { InkPoint, InkStroke } from "../application/freeform-ink";
import { canvasStrokePath, pathFor, strokeClass } from "../ui/canvas-ink";
import { excalidrawStrokeWidth, getFreeDrawSvgPath } from "../../ink/render/excalidraw-freedraw";

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

/** Excalidraw's freedraw path for the same points at the mapped width, as the wiring must produce. */
function excalidrawPath(pts: InkPoint[], width: number): string {
  const simulate = Math.abs((pts[0]?.pressure ?? 0.5) - 0.5) <= 1 / 255;
  return getFreeDrawSvgPath({
    points: pts.map((p) => [p.x, p.y]),
    pressures: pts.map((p) => p.pressure),
    strokeWidth: excalidrawStrokeWidth(width),
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

/** The canvas bar's pen presets, px (canvas-editor.tsx PEN_WIDTHS). */
const CANVAS_PEN_WIDTHS = [2, 4, 8, 16];

/** The outline's points, read from the path's number pairs (ends and control points). */
function outlinePoints(d: string): [number, number][] {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i]!, n[i + 1]!]);
  return out;
}

/** Mean drawn width: outline area over centreline length. */
function meanWidth(d: string, length: number): number {
  const o = outlinePoints(d);
  let twice = 0;
  o.forEach(([x, y], i) => {
    const [qx, qy] = o[(i + 1) % o.length]!;
    twice += x * qy - qx * y;
  });
  return Math.abs(twice) / 2 / length;
}

/** A slow stroke: samples 1 px apart, mouse pressure. */
function slowLine(): InkPoint[] {
  return Array.from({ length: 201 }, (_, i) => ({ x: 100 + i, y: 100, pressure: 0.5 }));
}
function slowArc(): InkPoint[] {
  const r = 80;
  const n = Math.round(Math.PI * r);
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI;
    return { x: 200 + Math.cos(a) * r, y: 200 + Math.sin(a) * r, pressure: 0.5 };
  });
}

test("a slow freehand line and curve are drawn at the preset width, every canvas preset", () => {
  for (const w of CANVAS_PEN_WIDTHS) {
    for (const [name, pts, length] of [
      ["line", slowLine(), 200],
      ["curve", slowArc(), Math.PI * 80],
    ] as const) {
      const drawn = meanWidth(canvasStrokePath(pts, w, "pen", "freehand"), length);
      assert.ok(
        Math.abs(drawn - w) <= 0.15 * w,
        `${w} px preset, slow ${name}: drawn ${drawn.toFixed(2)} px`,
      );
    }
  }
});

/** Nonzero winding of the outline around a point: inside the filled stroke when not 0. */
function winding(o: [number, number][], [px, py]: [number, number]): number {
  let wn = 0;
  o.forEach(([ax, ay], i) => {
    const [bx, by] = o[(i + 1) % o.length]!;
    const side = (bx - ax) * (py - ay) - (px - ax) * (by - ay);
    if (ay <= py && by > py && side > 0) wn++;
    else if (ay > py && by <= py && side < 0) wn--;
  });
  return wn;
}

test("a fast zig-zag keeps the gap between its legs open at every canvas preset", () => {
  // About 2 px/ms sampled every 4 ms: legs 100 px tall, 22 px apart at the base.
  const pts: InkPoint[] = [];
  const corners: [number, number][] = [];
  for (let k = 0; k <= 6; k++) corners.push([100 + k * 22, k % 2 === 0 ? 100 : 200]);
  for (let k = 0; k + 1 < corners.length; k++) {
    const [ax, ay] = corners[k]!;
    const [bx, by] = corners[k + 1]!;
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 8.7);
    for (let i = 0; i < steps; i++) {
      pts.push({ x: ax + ((bx - ax) * i) / steps, y: ay + ((by - ay) * i) / steps, pressure: 0.5 });
    }
  }
  pts.push({ x: corners.at(-1)![0], y: corners.at(-1)![1], pressure: 0.5 });
  for (const w of CANVAS_PEN_WIDTHS) {
    const o = outlinePoints(canvasStrokePath(pts, w, "pen", "freehand"));
    // Halfway between the legs, 60 px above the bottom corner at x 122 (26 px gap): paper, not ink.
    assert.equal(winding(o, [122, 140]), 0, `${w} px preset: the legs fuse at the corner`);
  }
});
