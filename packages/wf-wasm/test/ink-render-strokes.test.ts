import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { toRenderStrokes } from "../src/ink-render-strokes.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

const palette = {
  black: [0, 0, 0],
  yellow: [1, 1, 0],
  red: [1, 0, 0],
  blue: [0, 0, 1],
  text: [0.13, 0.14, 0.16],
} as const;

const stroke = (colour: string, tool: string) => ({ points: [0, 0, 0.5], width: 4, colour, tool });

test("resolves colours through the palette and flags highlighters", () => {
  const out = toRenderStrokes([stroke("black", "pen"), stroke("yellow", "highlighter")], palette);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.colour, "rgb(0, 0, 0)");
  assert.equal(out[0]!.highlighter, false);
  assert.equal(out[1]!.colour, "rgb(255, 255, 0)");
  assert.equal(out[1]!.highlighter, true);
  assert.equal(out[0]!.width, 4);
});

test("leaves out hidden positions and keeps the source points", () => {
  const source = [stroke("black", "pen"), stroke("red", "pen"), stroke("blue", "pen")];
  const out = toRenderStrokes(source, palette, new Set([0, 2]));
  assert.deepEqual(out.map((s) => s.colour), ["rgb(255, 0, 0)"]);
  assert.equal(out[0]!.points, source[1]!.points);
});

test("no strokes, or every stroke hidden, is empty", () => {
  assert.deepEqual(toRenderStrokes(undefined, palette), []);
  assert.deepEqual(toRenderStrokes([stroke("black", "pen")], palette, new Set([0])), []);
});

test("an unknown colour falls back to the text colour", () => {
  const out = toRenderStrokes([stroke("mauve", "pen")], palette);
  assert.equal(out[0]!.colour, "rgb(33, 36, 41)");
});
