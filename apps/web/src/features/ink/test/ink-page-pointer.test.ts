import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { HIGHLIGHTER_ALPHA } from "../render/canvas-renderer";
import { INK_TOOL_CURSORS, inkDotCursor, inkToolCursor } from "../ui/ink-page-pointer";

const svgOf = (cursor: string) => decodeURIComponent(cursor.slice(cursor.indexOf(",") + 1, cursor.indexOf('")')));

describe("inkDotCursor", () => {
  it("is a dot of the ink at the nib's size, hot spot at its centre", () => {
    const cursor = inkDotCursor("#1d4ed8", 10);
    const svg = svgOf(cursor);
    assert.match(svg, /width="14"/);
    assert.match(svg, /r="5" fill="#1d4ed8" fill-opacity="1"/);
    assert.match(cursor, /"\) 7 7, crosshair$/);
  });

  it("stays findable when tiny and under the browser's limit when huge", () => {
    assert.match(svgOf(inkDotCursor("#000", 0.3)), /width="8"/);
    assert.match(svgOf(inkDotCursor("#000", 900)), /width="68"/);
    assert.match(svgOf(inkDotCursor("#000", Number.NaN)), /width="8"/);
  });
});

describe("inkToolCursor", () => {
  const ink = { hex: "#e8c21a", diameterPx: 20 };

  it("gives the pen its ink and the highlighter its ink see-through", () => {
    assert.match(svgOf(inkToolCursor("pen", ink)), /fill="#e8c21a" fill-opacity="1"/);
    assert.match(svgOf(inkToolCursor("highlighter", ink)), new RegExp(`fill-opacity="${HIGHLIGHTER_ALPHA}"`));
  });

  it("keeps the table's shape for tools that lay no ink", () => {
    assert.equal(inkToolCursor("eraser", ink), INK_TOOL_CURSORS.eraser);
    assert.equal(inkToolCursor("lasso", ink), INK_TOOL_CURSORS.lasso);
    assert.equal(inkToolCursor("pen"), INK_TOOL_CURSORS.pen);
  });
});
