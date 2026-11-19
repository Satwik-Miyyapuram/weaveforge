/**
 * The freeform page draws each stroke's stored (canonical) colour through the
 * live theme: dark ink drawn on Paper shows light on a dark theme, and the
 * stroke being drawn does the same. The stored stroke is not touched.
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { parseHex } from "culori";

import { loadTestCore } from "@/lib/test/load-test-core";
import { INK_RENDER_COLOURS, type InkPalette } from "@/features/ink/render/parts-1";
import { inkThemeOf, type ThemeInk } from "@/features/ink/render/resolve-ink-colour";
import { encodeStroke, type InkPoint, type InkStroke } from "../application/freeform-ink";
import { InkLayer } from "../ui/canvas-ink";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
before(loadTestCore);

function darkInk(): ThemeInk {
  const c = parseHex("#e7ebf1")!;
  const palette: InkPalette = { ...INK_RENDER_COLOURS, text: [c.r, c.g, c.b] };
  return { palette, theme: inkThemeOf(palette, "#14171c") };
}

test("strokes and the draft draw in the theme's colours; the stored colour stays", () => {
  const points = [
    { x: 0, y: 0, pressure: 0.5 },
    { x: 5, y: 5, pressure: 0.5 },
  ] as InkPoint[];
  const stroke: InkStroke = encodeStroke({ id: "s1", width: 2, colour: "#2b2924", points });
  const draft = { points, colour: "#2b2924", width: 2, tool: "pen" };
  let root!: ReactTestRenderer;
  act(() => {
    root = create(
      createElement(InkLayer, { strokes: [stroke], selected: new Set<string>(), draft, renderer: "classic", ink: darkInk() }),
    );
  });
  const paths = root.root.findAllByType("path");
  assert.deepEqual(
    paths.map((p) => p.props.stroke),
    ["#e7ebf1", "#e7ebf1"],
  );
  assert.equal(stroke.c, "#2b2924");
  act(() => root.unmount());
});
