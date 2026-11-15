/**
 * A page canvas's backing pixels must be exactly its CSS size times the device
 * pixel ratio. When they are off by half a pixel (CSS 815px at 1.5x is 1222.5
 * device pixels, the canvas 1223) the browser resamples the whole page and
 * the text goes soft.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { canvasSize } from "../canvas-size";

const exact = (s: ReturnType<typeof canvasSize>, ratio: number) =>
  s.pixelWidth === s.cssWidth * ratio && s.pixelHeight === s.cssHeight * ratio;

test("an odd width at 1.5x snaps to an exact pair", () => {
  const s = canvasSize(815.4, 1055.9, 1.5);
  assert.ok(exact(s, 1.5), JSON.stringify(s));
  assert.ok(s.cssWidth <= 815 && s.cssWidth >= 814);
});

test("every common ratio gives exact pixels over a range of sizes", () => {
  for (const ratio of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
    for (let w = 300; w < 1400; w += 7.3) {
      const s = canvasSize(w, w * 1.29, ratio);
      assert.ok(exact(s, ratio), `${ratio} ${w} ${JSON.stringify(s)}`);
      // Never grows past the page and never loses more than a few CSS pixels.
      assert.ok(s.cssWidth <= Math.floor(w) && s.cssWidth >= Math.floor(w) - 4, `${ratio} ${w}`);
    }
  }
});

test("ratio 1 is a plain floor", () => {
  assert.deepEqual(canvasSize(612.7, 792.2, 1), { cssWidth: 612, cssHeight: 792, pixelWidth: 612, pixelHeight: 792 });
});

test("ratio 2 doubles the floored CSS size", () => {
  assert.deepEqual(canvasSize(613.9, 793, 2), { cssWidth: 613, cssHeight: 793, pixelWidth: 1226, pixelHeight: 1586 });
});

test("an odd ratio with no small fraction still never blurs past a floor", () => {
  const s = canvasSize(800, 1000, 1.1);
  assert.ok(exact(s, 1.1) || (s.pixelWidth === Math.floor(800 * 1.1) && s.cssWidth === 800));
});

test("a bad ratio falls back to 1", () => {
  for (const r of [0, -1, Number.NaN]) {
    assert.deepEqual(canvasSize(100.5, 200.5, r), { cssWidth: 100, cssHeight: 200, pixelWidth: 100, pixelHeight: 200 });
  }
});
