/**
 * One mapping from stored strokes to what the renderer draws, shared by the
 * live canvas and the static SVG layer (20-07).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { InkStroke } from "@weaveforge/core";

import { toRenderStrokes } from "../ui/ink-render-strokes";
import { INK_RENDER_COLOURS, paletteCss } from "../render/ink-palette";

const stroke = (colour: string, tool: string): InkStroke =>
  ({ points: [0, 0, 0.5], width: 4, colour, tool }) as unknown as InkStroke;

test("resolves colours through the palette and flags highlighters", () => {
  const out = toRenderStrokes([stroke("black", "pen"), stroke("yellow", "highlighter")], INK_RENDER_COLOURS);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.colour, paletteCss(INK_RENDER_COLOURS, "black" as never));
  assert.equal(out[0]!.highlighter, false);
  assert.equal(out[1]!.highlighter, true);
  assert.equal(out[0]!.width, 4);
});

test("leaves out hidden positions", () => {
  const out = toRenderStrokes([stroke("black", "pen"), stroke("red", "pen"), stroke("blue", "pen")], INK_RENDER_COLOURS, new Set([0, 2]));
  assert.deepEqual(out.map((s) => s.colour), [paletteCss(INK_RENDER_COLOURS, "red" as never)]);
});

test("no strokes, or every stroke hidden, is empty", () => {
  assert.deepEqual(toRenderStrokes(undefined, INK_RENDER_COLOURS), []);
  assert.deepEqual(toRenderStrokes([stroke("black", "pen")], INK_RENDER_COLOURS, new Set([0])), []);
});
