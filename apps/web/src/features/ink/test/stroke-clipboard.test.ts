import { test } from "node:test";
import assert from "node:assert/strict";

import { makeInkStroke } from "@weaveforge/core";

import { parseStrokeClip, pastedStrokesPlace, strokeClipText } from "../application/stroke-clipboard";

const page = { width: 2100, height: 2970 };
const line = (x: number, y: number) =>
  makeInkStroke({ points: [x, y, x + 100, y + 20], pressures: [100, 200], width: 9, colour: "red" });

test("copied strokes come back from the clipboard text as they were", () => {
  const back = parseStrokeClip(strokeClipText([line(10, 20)]));
  assert.equal(back?.length, 1);
  assert.deepEqual(back![0]!.points, [10, 20, 110, 40]);
  assert.deepEqual(back![0]!.pressures, [100, 200]);
  assert.equal(back![0]!.width, 9);
  assert.equal(back![0]!.colour, "red");
});

test("text that is not a stroke clip, or carries no valid stroke, is not ink", () => {
  assert.equal(parseStrokeClip("hello"), null);
  assert.equal(parseStrokeClip(null), null);
  assert.equal(parseStrokeClip("weaveforge-ink:{bad json"), null);
  assert.equal(parseStrokeClip('weaveforge-ink:{"strokes":[{"points":[1,2,3]}]}'), null);
  assert.equal(parseStrokeClip('weaveforge-ink:{"strokes":[{"points":[1,2,"x",4]}]}'), null);
});

test("a paste into another note keeps the strokes where they were", () => {
  const [placed] = pastedStrokesPlace([line(10, 20)], [], page);
  assert.deepEqual(placed!.points, [10, 20, 110, 40]);
});

test("a paste onto the page it came from steps clear of the original", () => {
  const original = line(10, 20);
  const [placed] = pastedStrokesPlace([original], [original], page);
  assert.deepEqual(placed!.points, [60, 70, 160, 90]);
});

test("a paste that would run off the page is pulled back onto it", () => {
  const [placed] = pastedStrokesPlace([line(2050, 2960)], [], page);
  assert.deepEqual(placed!.points, [2000, 2950, 2100, 2970]);
});
