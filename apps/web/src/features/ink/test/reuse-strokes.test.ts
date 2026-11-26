import { test } from "node:test";
import assert from "node:assert/strict";
import type { InkStroke } from "@weaveforge/core";

import { reuseStrokes } from "../ui/use-live-sheet-ink";

function stroke(t0: number, points: number[], width = 5): InkStroke {
  const pressures = points.slice(0, points.length / 2).map(() => 128);
  return { points, pressures, width, tool: "pen", colour: "text", t0, shape: "none", lineIndex: -1 };
}

const clone = (strokes: readonly InkStroke[]): InkStroke[] => structuredClone(strokes) as InkStroke[];

test("the worker's copy of unchanged strokes hands the prior list back", () => {
  const prior = [stroke(1, [0, 0, 1, 1]), stroke(2, [5, 5, 6, 6])];
  assert.equal(reuseStrokes(clone(prior), prior), prior);
});

test("an appended stroke keeps the earlier stroke objects", () => {
  const prior = [stroke(1, [0, 0, 1, 1]), stroke(2, [5, 5, 6, 6])];
  const next = [...clone(prior), stroke(3, [9, 9, 8, 8])];
  const out = reuseStrokes(next, prior);
  assert.notEqual(out, prior);
  assert.equal(out[0], prior[0]);
  assert.equal(out[1], prior[1]);
  assert.equal(out[2], next[2]);
});

test("an erased stroke in the middle keeps the strokes after it", () => {
  const prior = [stroke(1, [0, 0, 1, 1]), stroke(2, [5, 5, 6, 6]), stroke(3, [9, 9, 8, 8])];
  const out = reuseStrokes(clone([prior[0], prior[2]]), prior);
  assert.deepEqual(out, [prior[0], prior[2]]);
  assert.equal(out[1], prior[2]);
});

test("a moved or restyled stroke is not reused", () => {
  const prior = [stroke(1, [0, 0, 1, 1])];
  const moved = reuseStrokes([stroke(1, [0, 0, 1, 2])], prior);
  assert.notEqual(moved[0], prior[0]);
  const wider = reuseStrokes([stroke(1, [0, 0, 1, 1], 9)], prior);
  assert.notEqual(wider[0], prior[0]);
  const recoloured = reuseStrokes([{ ...clone(prior)[0], colour: "red" } as InkStroke], prior);
  assert.notEqual(recoloured[0], prior[0]);
});

test("no prior list returns the worker's list as is", () => {
  const next = [stroke(1, [0, 0, 1, 1])];
  assert.equal(reuseStrokes(next, undefined), next);
});

test("two equal strokes each reuse a different prior object", () => {
  const prior = [stroke(1, [0, 0, 1, 1]), stroke(1, [0, 0, 1, 1])];
  const out = reuseStrokes(clone(prior), prior);
  assert.equal(out, prior);
});
