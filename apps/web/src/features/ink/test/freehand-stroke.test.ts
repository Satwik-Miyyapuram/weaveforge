import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_INK_RENDERER,
  freehandOutline,
  outlinePathData,
  parseInkRenderer,
  tldrawPenOptions,
} from "../render/freehand-stroke";

const WIDTH = 10;

function points(coords: [number, number][]) {
  return {
    x: Float32Array.from(coords.map(([x]) => x)),
    y: Float32Array.from(coords.map(([, y]) => y)),
    pressure: Uint8Array.from(coords.map(() => 255)),
  };
}

function extentFrom(
  outline: readonly (readonly [number, number])[],
  cx: number,
  cy: number,
) {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of outline) {
    const d = Math.hypot(x - cx, y - cy);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

test("a V cusp keeps its apex: the outline reaches the tip", () => {
  // A real pen samples densely. Three sparse points leave the streamline
  // too little data and pull the tip back to y≈104, which is the library's
  // behaviour for sparse input, not a bug in the adapter.
  const v: [number, number][] = [];
  for (let i = 0; i <= 20; i++) v.push([(i / 20) * 100, (i / 20) * 200]);
  for (let i = 1; i <= 20; i++) v.push([100 + (i / 20) * 100, 200 - (i / 20) * 200]);
  const outline = freehandOutline(points(v), WIDTH, { last: true, simulatePressure: false });
  const size = tldrawPenOptions(WIDTH, true, false).size as number;
  const lowest = Math.max(...outline.map(([, y]) => y));
  // Streamline lags the tip by a little; it must stay within half a pen width.
  assert.ok(lowest >= 200 - size / 2, `outline lowest y ${lowest} does not reach apex 200 within ${size / 2}`);
});

test("a small loop stays a loop: the outline has an inner and an outer edge", () => {
  const cx = 300;
  const cy = 300;
  const radius = 40;
  const ring: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ring.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  const outline = freehandOutline(points(ring), WIDTH, { last: true, simulatePressure: false });
  assert.ok(outline.length > 10, "a loop must produce an outline");
  const { min, max } = extentFrom(outline, cx, cy);
  // Inner edge sits inside the ring and outer edge outside it: the loop stays open in the middle.
  assert.ok(min < radius - 2, `inner edge ${min} missing; loop filled in or collapsed`);
  assert.ok(max > radius + 2, `outer edge ${max} missing`);
});

test("an empty stroke has no outline and no path data", () => {
  const none = points([]);
  assert.deepEqual(freehandOutline(none, WIDTH, { last: true, simulatePressure: false }), []);
  assert.equal(outlinePathData([]), "");
});

test("outline path data is a closed M/L path", () => {
  const d = outlinePathData([
    [0, 0],
    [10, 0],
    [10, 10],
  ]);
  assert.equal(d, "M0 0 L10 0 L10 10 Z");
});

test("the setting picks the renderer; anything unknown stays classic", () => {
  assert.equal(DEFAULT_INK_RENDERER, "classic");
  assert.equal(parseInkRenderer("freehand"), "freehand");
  assert.equal(parseInkRenderer("classic"), "classic");
  assert.equal(parseInkRenderer("FREEHAND"), "classic");
  assert.equal(parseInkRenderer(undefined), "classic");
  assert.equal(parseInkRenderer(1), "classic");
});
