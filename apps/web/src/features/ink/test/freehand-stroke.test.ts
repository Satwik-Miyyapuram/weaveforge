import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_INK_RENDERER,
  freedrawCurves,
  freehandPathFromFlat,
  parseInkRenderer,
} from "../render/freehand-stroke";
import { freedrawPath, getFreeDrawSvgPath } from "../render/excalidraw-freedraw";

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

test("the paper path is Excalidraw's own function output on simulated pressure, 2 px and 4 px", () => {
  const flat = flatCircle(20, 30);
  const x = flat.filter((_, i) => i % 2 === 0);
  const y = flat.filter((_, i) => i % 2 === 1);
  for (const width of [2, 4]) {
    assert.equal(
      freehandPathFromFlat(flat, width),
      getFreeDrawSvgPath({
        points: x.map((v, i) => [v, y[i]!]),
        pressures: x.map(() => 0.5),
        strokeWidth: width,
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
  // One `Q` token, then four numbers per curve. The outline has more points than the input.
  const body = d.slice(d.indexOf(" Q ") + 3, d.indexOf(" L "));
  assert.equal(parsed.curves.length, (body.match(/-?\d*\.?\d+/g) ?? []).length / 4);
  for (const v of [parsed.start[0], parsed.start[1], ...parsed.curves.flat()]) {
    assert.ok(Number.isFinite(v));
  }
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
