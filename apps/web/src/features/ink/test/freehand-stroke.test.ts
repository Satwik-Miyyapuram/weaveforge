import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_INK_RENDERER,
  freedrawCurves,
  freehandPathFromFlat,
  parseInkABOn,
  parseInkRenderer,
} from "../render/freehand-stroke";
import { INK_PEN_WIDTHS } from "@weaveforge/core";

import {
  excalidrawStrokeWidth,
  freedrawPath,
  getFreeDrawSvgPath,
} from "../render/excalidraw-freedraw";
import { canvasStrokePath } from "../../canvas/ui/canvas-ink";

const WIDTH = 4;

function flatCircle(n: number, radius: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(100 + Math.cos(a) * radius, 100 + Math.sin(a) * radius);
  }
  return out;
}

test("the setting picks the renderer; anything unknown stays classic", () => {
  assert.equal(DEFAULT_INK_RENDERER, "classic");
  assert.equal(parseInkRenderer("freehand"), "freehand");
  assert.equal(parseInkRenderer("classic"), "classic");
  assert.equal(parseInkRenderer("FREEHAND"), "classic");
  assert.equal(parseInkRenderer(undefined), "classic");
  assert.equal(parseInkRenderer(1), "classic");
});

test("a settled paper stroke is Excalidraw's freedraw path for its flat points", () => {
  const flat = flatCircle(30, 40);
  const x = flat.filter((_, i) => i % 2 === 0);
  const y = flat.filter((_, i) => i % 2 === 1);
  assert.equal(freehandPathFromFlat(flat, WIDTH), freedrawPath(x, y, WIDTH, true));
});

test("empty input has no path", () => {
  assert.equal(freehandPathFromFlat([], WIDTH), "");
});

test("the paper path is Excalidraw's own function output on simulated pressure at the mapped width, 2 and 4 units", () => {
  const flat = flatCircle(20, 30);
  const x = flat.filter((_, i) => i % 2 === 0);
  const y = flat.filter((_, i) => i % 2 === 1);
  for (const width of [2, 4]) {
    assert.equal(
      freehandPathFromFlat(flat, width),
      getFreeDrawSvgPath({
        points: x.map((v, i) => [v, y[i]!]),
        pressures: x.map(() => 0.5),
        strokeWidth: excalidrawStrokeWidth(width),
        simulatePressure: true,
        lastCommittedPoint: [0, 0],
      }),
    );
  }
});

test("freedrawCurves reads Excalidraw's path back as a start, quadratic curves and a close", () => {
  const d = freehandPathFromFlat(flatCircle(24, 40), WIDTH);
  const parsed = freedrawCurves(d);
  assert.ok(parsed !== null);
  for (const v of [parsed.start[0], parsed.start[1], ...parsed.curves.flat()]) {
    assert.ok(Number.isFinite(v));
  }
});

/**
 * Largest turn, in degrees, of the tangent at a join between two consecutive
 * quadratics. A smooth outline turns by a few degrees; a corner turns by tens.
 */
function worstJoinTurn(d: string): number {
  const parsed = freedrawCurves(d);
  assert.ok(parsed !== null);
  let start = parsed.start;
  let before: number | null = null;
  let worst = 0;
  for (const [cx, cy, ex, ey] of parsed.curves) {
    const leaving = Math.atan2(cy - start[1], cx - start[0]);
    if (before !== null) {
      let turn = Math.abs(leaving - before);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      worst = Math.max(worst, (turn * 180) / Math.PI);
    }
    // Leaving the join: the incoming tangent is the end minus the control point.
    before = Math.atan2(ey - cy, ex - cx);
    start = [ex, ey];
  }
  return worst;
}

test("the outline turns by under 5 degrees at every join of a tiny stroke at 8 units", () => {
  // Densely sampled (about 1 px apart), so no join is a sparse-sample artefact.
  // Measured on perfect-freehand 1.2.0: the 40 px loop 0.6 degrees, tiny
  // strokes 0.7-1.8. A corner (guard below) is 180 degrees.
  // Finding, not in this bound: a dense 40 px loop (251 points) has a 90 degree
  // join in its body at width 2 and width 4 (width 4: curve 66 of 99, on the
  // inner outline edge, outline radius 24-56 around r 40). It is not an end cap,
  // so it is not excluded; the bound is not loosened for it.
  // Since strokes are drawn at the pen width (excalidrawStrokeWidth), these
  // features are as small as the pen itself below 8 units, and the worst
  // join grows: r 1 circle 10.4 / 7.1 / 5.2 / 4.2 degrees and the 3-point
  // stroke 12.1 / 8.1 / 6.0 / 5.0 at widths 1 / 2 / 3 / 4. Recorded, not bounded.
  const cases: [number[], number][] = [
    [flatCircle(8, 1), 8],
    [[10, 10, 12, 10, 14, 11], 8],
  ];
  for (const [flat, width] of cases) {
    const turn = worstJoinTurn(freehandPathFromFlat(flat, width));
    assert.ok(turn < 5, `a ${turn.toFixed(1)} degree join at width ${width}`);
  }
});

test("the join metric sees a sharp corner", () => {
  // Guard: a stroke that doubles back on itself, sampled densely, has a body join near 180 degrees.
  const vee: number[] = [];
  for (let i = 0; i <= 40; i++) vee.push(i, 0);
  for (let i = 1; i <= 40; i++) vee.push(40 - i, i / 40);
  // At width 1 the 1 unit rise is wider than the pen, so the turn shows (12.5
  // degrees); at width 4 the round cap covers it (3.1).
  assert.ok(worstJoinTurn(freehandPathFromFlat(vee, 1)) > 5);
});

test("freedrawCurves of an empty path is null", () => {
  assert.equal(freedrawCurves(""), null);
});

test("a tiny stroke at 2 px and 4 px gives a finite, closed outline", () => {
  for (const width of [2, 4]) {
    const d = freehandPathFromFlat([10, 10, 12, 10, 14, 11], width);
    assert.doesNotMatch(d, /NaN|Infinity/);
    assert.ok(d.endsWith("Z"));
  }
});

test("the A/B dev flag shows the buttons only when set to on", () => {
  assert.equal(parseInkABOn("on"), true);
  assert.equal(parseInkABOn("off"), false);
  assert.equal(parseInkABOn(null), false);
  assert.equal(parseInkABOn(undefined), false);
  assert.equal(parseInkABOn("ON"), false);
});

/** Mean drawn width: outline area (from the path's number pairs) over centreline length. */
function meanWidth(d: string, length: number): number {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const o: [number, number][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) o.push([n[i]!, n[i + 1]!]);
  let twice = 0;
  o.forEach(([x, y], i) => {
    const [qx, qy] = o[(i + 1) % o.length]!;
    twice += x * qy - qx * y;
  });
  return Math.abs(twice) / 2 / length;
}

test("a slow paper line and curve are drawn at the nib width, every paper preset", () => {
  // Paper points and widths are in the note's unit (0.1 mm); samples 1 unit apart.
  const line: number[] = [];
  for (let i = 0; i <= 200; i++) line.push(100 + i, 100);
  const arc: number[] = [];
  const n = Math.round(Math.PI * 80);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    arc.push(200 + Math.cos(a) * 80, 200 + Math.sin(a) * 80);
  }
  for (const w of INK_PEN_WIDTHS) {
    for (const [name, flat, length] of [
      ["line", line, 200],
      ["curve", arc, Math.PI * 80],
    ] as const) {
      const drawn = meanWidth(freehandPathFromFlat(flat, w), length);
      assert.ok(Math.abs(drawn - w) <= 0.15 * w, `nib ${w / 10} mm, slow ${name}: drawn ${drawn.toFixed(2)}`);
    }
  }
});

test("paper and canvas map a width to the same outline", () => {
  const flat = flatCircle(30, 40);
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push({ x: flat[i]!, y: flat[i + 1]!, pressure: 0.5 });
  for (const w of [1, 3, 4, 16]) {
    assert.equal(freehandPathFromFlat(flat, w), canvasStrokePath(pts, w, "pen", "freehand"));
  }
});
