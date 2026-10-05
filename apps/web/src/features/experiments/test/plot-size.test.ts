import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_CARD_PX, plotHeight } from "../ui/plot-size";

test("a wide card keeps the base height", () => {
  assert.equal(plotHeight(1200, 320), 320);
});

test("a narrow card scales height with its width", () => {
  assert.equal(plotHeight(400, 320), 248);
});

test("the narrowest allowed card still gets a readable plot", () => {
  assert.ok(plotHeight(MIN_CARD_PX, 320) >= 150);
  assert.equal(plotHeight(120, 320), 150);
});

test("an unmeasured card falls back to base", () => {
  assert.equal(plotHeight(0, 240), 240);
});
