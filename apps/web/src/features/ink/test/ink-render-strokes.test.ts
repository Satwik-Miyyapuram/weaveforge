/**
 * One mapping from stored strokes to what the renderer draws, shared by the
 * live canvas and the static SVG layer (20-07).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { InkStroke } from "@weaveforge/core";

import { readyCore } from "@/lib/rust-core";
import { INK_RENDER_COLOURS } from "../render/ink-palette";

const stroke = (colour: string, tool: string): InkStroke =>
  ({ points: [0, 0, 0.5], width: 4, colour, tool }) as unknown as InkStroke;

test("resolves colours through the palette and flags highlighters", () => {
  const out = readyCore().toRenderStrokes([stroke("black", "pen"), stroke("yellow", "highlighter")], INK_RENDER_COLOURS);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.colour, readyCore().paletteCss(INK_RENDER_COLOURS, "black" as never, 1));
  assert.equal(out[0]!.highlighter, false);
  assert.equal(out[1]!.highlighter, true);
  assert.equal(out[0]!.width, 4);
});

test("leaves out hidden positions", () => {
  const out = readyCore().toRenderStrokes([stroke("black", "pen"), stroke("red", "pen"), stroke("blue", "pen")], INK_RENDER_COLOURS, new Set([0, 2]));
  assert.deepEqual(out.map((s) => s.colour), [readyCore().paletteCss(INK_RENDER_COLOURS, "red" as never, 1)]);
});

test("no strokes, or every stroke hidden, is empty", () => {
  assert.deepEqual(readyCore().toRenderStrokes(undefined, INK_RENDER_COLOURS), []);
  assert.deepEqual(readyCore().toRenderStrokes([stroke("black", "pen")], INK_RENDER_COLOURS, new Set([0])), []);
});
