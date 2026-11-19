/**
 * The freeform page's starting pen colour follows the theme's text colour, so
 * a new stroke shows on a dark page as well as a light one.
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";

import { loadTestCore } from "@/lib/test/load-test-core";
import { INK_RENDER_COLOURS, type InkPalette } from "@/features/ink/render/parts-1";
import { defaultPenColour } from "../application/pen-colour";

before(loadTestCore);

const DARK: InkPalette = { ...INK_RENDER_COLOURS, text: [0.9, 0.91, 0.93] };

test("on a dark theme the default pen is the theme's light text colour", () => {
  const colour = defaultPenColour(DARK);
  assert.match(colour, /^#[0-9a-f]{6}$/, "a hex the colour input accepts");
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
  assert.ok(Math.min(r!, g!, b!) > 200, `${colour} is light`);
});

test("on a light theme the default pen is the theme's dark text colour", () => {
  const colour = defaultPenColour(INK_RENDER_COLOURS);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
  assert.ok(Math.max(r!, g!, b!) < 60, `${colour} is dark`);
});

test("without a palette (no document) the default is the light theme's text", () => {
  assert.equal(defaultPenColour(null), defaultPenColour(INK_RENDER_COLOURS));
});
