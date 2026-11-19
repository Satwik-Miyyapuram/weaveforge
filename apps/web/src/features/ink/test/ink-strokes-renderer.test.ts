import assert from "node:assert/strict";
import { test } from "node:test";

import { readyCore } from "@/lib/rust-core";
import { settledStrokePath } from "../ui/ink-strokes";

const POINTS = [0, 0, 50, 0, 100, 20];
const WIDTH = 10;

test("the settled stroke is the capsule path when the renderer is classic", () => {
  assert.equal(settledStrokePath(POINTS, WIDTH, "classic"), readyCore().strokePath(POINTS));
});

test("the settled stroke is the perfect-freehand outline when the renderer is freehand", () => {
  const d = settledStrokePath(POINTS, WIDTH, "freehand") ?? "";
  assert.match(d, /^M/);
  assert.ok(d.endsWith(" Z"));
  assert.notEqual(d, readyCore().strokePath(POINTS));
});
