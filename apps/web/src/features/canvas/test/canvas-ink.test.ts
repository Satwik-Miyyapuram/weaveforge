import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeStroke, encodeStroke, type InkPoint, type InkStroke } from "../application/freeform-ink";
import { inkFreedrawPath } from "../../ink/render/excalidraw-freedraw";
import { canvasStrokePath, pathFor, settledCanvasPath, strokeClass } from "../ui/canvas-ink";

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

test("freehand real pen pressure sets the width: firm is wider than light, mid matches the mouse", () => {
  const line = (pressure: number) => slowLine().map((p) => ({ ...p, pressure }));
  const w = 8;
  const light = meanWidth(canvasStrokePath(line(0.2), w, "pen"), 200);
  const firm = meanWidth(canvasStrokePath(line(0.8), w, "pen"), 200);
  const mid = meanWidth(canvasStrokePath(line(0.51), w, "pen"), 200);
  const mouse = meanWidth(canvasStrokePath(slowLine(), w, "pen"), 200);
  assert.ok(firm > 1.5 * light, `firm ${firm.toFixed(2)} vs light ${light.toFixed(2)}`);
  assert.ok(Math.abs(mid - mouse) <= 0.15 * mouse, `pen mid ${mid.toFixed(2)} vs mouse ${mouse.toFixed(2)}`);
});

test("freehand closes with one straight segment (Excalidraw's Z) and draws curves", () => {
  for (const spacing of [60, 20]) {
    const d = canvasStrokePath(circle(spacing, 40), 2, "pen");
    assert.match(d, /^M/);
    assert.match(d, /Q/);
    assert.equal(d.match(/ L /g)?.length, 1, "only the closing L");
    assert.doesNotMatch(d, /NaN|Infinity/);
  }
});

test("freehand sparse and jittered input still draws curves, not facets", () => {
  for (const pts of [circle(14, 40), circle(120, 40, 0.8)]) {
    const d = canvasStrokePath(pts, 2, "pen");
    assert.equal(d.match(/ L /g)?.length, 1, "no facet: only the closing L");
    assert.doesNotMatch(d, /NaN/);
  }
});

test("wet and settled use the same path for the same points", () => {
  const pts = circle(30, 40);
  assert.equal(
    canvasStrokePath(pts, 2, "pen"),
    canvasStrokePath([...pts], 2, "pen"),
  );
});

test("the path function leaves the stored points untouched", () => {
  const pts = circle(30, 40);
  const before = JSON.stringify(pts);
  canvasStrokePath(pts, 2, "pen");
  assert.equal(JSON.stringify(pts), before);
});

test("a single point is a dot", () => {
  const one = [{ x: 5, y: 6, pressure: 0.5 }];
  assert.equal(canvasStrokePath(one, 2, "pen"), pathFor(one));
});

test("a highlighter and a pen share one outline; only the CSS opacity differs", () => {
  const pts = circle(30, 40);
  assert.equal(
    canvasStrokePath(pts, 2, "highlighter"),
    canvasStrokePath(pts, 2, "pen"),
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

/**
 * OneNote's drawn body width over its nominal pen width, measured by replaying
 * one SendInput stroke file into OneNote (Pen 0.25 mm, 1.89 device px at DPR 2)
 * and taking the median cross-section: 2.5 px on slow curves, circles, stars
 * and minimum loops, so about 1.32 times the nominal width, at any speed.
 */
const ONENOTE_BODY_RATIO = 1.32;

/** A mouse line `length` px long, samples `step` px apart (1 = slow, 8 = a fast 4 ms pointer). */
function mouseLine(step: number, length = 400): InkPoint[] {
  const n = Math.round(length / step);
  return Array.from({ length: n + 1 }, (_, i) => ({ x: 100 + (i * length) / n, y: 100, pressure: 0.5 }));
}
function slowLine(): InkPoint[] {
  return mouseLine(1, 200);
}
/** An arc of radius 160 through `turn` radians, samples `step` px apart. */
function mouseArc(step: number, turn: number): InkPoint[] {
  const r = 160;
  const n = Math.round((turn * r) / step);
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * turn;
    return { x: 300 + Math.cos(a) * r, y: 300 + Math.sin(a) * r, pressure: 0.5 };
  });
}

/** Outline area of a path, by the shoelace sum over its number pairs. */
function area(d: string): number {
  return meanWidth(d, 1);
}

test("a mouse freehand line and curve are OneNote's width at every canvas preset, slow or fast", () => {
  // Body width = extra area of a stroke twice as long over its extra length, so the end caps cancel.
  for (const w of CANVAS_PEN_WIDTHS) {
    for (const step of [1, 8]) {
      for (const [name, short, long, extra] of [
        ["line", mouseLine(step, 400), mouseLine(step, 800), 400],
        ["curve", mouseArc(step, Math.PI / 2), mouseArc(step, Math.PI), (Math.PI / 2) * 160],
      ] as const) {
        const draw = (pts: InkPoint[]) => area(canvasStrokePath(pts, w, "pen"));
        const drawn = (draw(long) - draw(short)) / extra;
        assert.ok(
          Math.abs(drawn / w - ONENOTE_BODY_RATIO) <= 0.1 * ONENOTE_BODY_RATIO,
          `${w} px preset, ${name} sampled every ${step} px: drawn ${drawn.toFixed(2)} px (${(drawn / w).toFixed(2)}x)`,
        );
      }
    }
  }
});

test("a mouse freehand stroke keeps one width whatever the sample spacing", () => {
  for (const w of CANVAS_PEN_WIDTHS) {
    const dense = meanWidth(canvasStrokePath(mouseLine(1), w, "pen"), 400);
    for (const step of [4, 10, 25]) {
      const sparse = meanWidth(canvasStrokePath(mouseLine(step), w, "pen"), 400);
      assert.ok(
        Math.abs(sparse - dense) <= 0.05 * dense,
        `${w} px preset: ${step} px spacing ${sparse.toFixed(2)} vs dense ${dense.toFixed(2)}`,
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
    const o = outlinePoints(canvasStrokePath(pts, w, "pen"));
    // Halfway between the legs, 60 px above the bottom corner at x 122 (26 px gap): paper, not ink.
    assert.equal(winding(o, [122, 140]), 0, `${w} px preset: the legs fuse at the corner`);
  }
});

test("a pen stroke whose first sample is at mid pressure still draws with its real pressure", () => {
  const pts = slowLine().map((p, i) => ({ ...p, pressure: i === 0 ? 0.5 : 0.85 }));
  const mouse = slowLine().map((p) => ({ ...p, pressure: 0.5 }));
  const d = canvasStrokePath(pts, 8, "pen");
  assert.notEqual(d, canvasStrokePath(mouse, 8, "pen"));
  assert.equal(
    d,
    inkFreedrawPath(pts.map((p) => [p.x, p.y]), pts.map((p) => p.pressure), 8, false, true),
  );
});

test("a settled stroke's path is computed once per stroke", () => {
  const stroke = encodeStroke({ id: "c1", width: 2, colour: "#000000", points: circle(30, 40) });
  const first = settledCanvasPath(stroke);
  assert.equal(first, canvasStrokePath(decodeStroke(stroke), 2, "pen"));
  // Strokes are immutable: an in-place edit is not seen, which shows the cache answered.
  (stroke.p as number[])[2] = 999;
  assert.equal(settledCanvasPath(stroke), first);
  // A new stroke object (an edit replaces the stroke) is computed afresh.
  const moved = { ...stroke, x: stroke.x + 10 };
  assert.notEqual(settledCanvasPath(moved), first);
});
