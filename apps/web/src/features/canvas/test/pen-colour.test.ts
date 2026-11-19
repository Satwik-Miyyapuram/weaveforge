/**
 * The freeform page's pen starts at the text slot in canonical (Paper) form,
 * so a new stroke draws as the theme's text colour on any theme and exports
 * as dark ink on white.
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";

import { parseHex } from "culori";

import { loadTestCore } from "@/lib/test/load-test-core";
import { INK_RENDER_COLOURS, type InkPalette } from "@/features/ink/render/parts-1";
import { inkThemeOf, resolveInkColour } from "@/features/ink/render/resolve-ink-colour";
import { DEFAULT_PEN_COLOUR } from "../application/pen-colour";

before(loadTestCore);

test("the default pen is a hex the colour input and Excalidraw export accept", () => {
  assert.match(DEFAULT_PEN_COLOUR, /^#[0-9a-f]{6}$/);
});

test("on a dark theme the default pen draws as the theme's light text colour", () => {
  const c = parseHex("#e7ebf1")!;
  const palette: InkPalette = { ...INK_RENDER_COLOURS, text: [c.r, c.g, c.b] };
  const drawn = resolveInkColour(DEFAULT_PEN_COLOUR, { palette, theme: inkThemeOf(palette, "#14171c") });
  assert.equal(drawn, "#e7ebf1");
});
