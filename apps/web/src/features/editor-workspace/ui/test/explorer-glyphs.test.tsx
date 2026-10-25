import { test } from "node:test";
import assert from "node:assert/strict";

import { CloseGlyph } from "../explorer-glyphs";

type Props = Parameters<typeof CloseGlyph>[0];

/** The svg's own props, read off the element the glyph returns. */
function svgProps(props: Props) {
  return CloseGlyph(props).props as Record<string, unknown>;
}

test("CloseGlyph keeps the explorer's 11px / 2 stroke by default (28-24)", () => {
  const props = svgProps({});
  assert.equal(props.width, 11);
  assert.equal(props.height, 11);
  assert.equal(props.strokeWidth, 2);
});

test("CloseGlyph takes the pane tab's size and stroke (28-24)", () => {
  const props = svgProps({ size: 12, stroke: 2.2 });
  assert.equal(props.width, 12);
  assert.equal(props.height, 12);
  assert.equal(props.strokeWidth, 2.2);
});
