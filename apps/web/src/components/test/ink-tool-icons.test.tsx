import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { toolIcon, type InkToolGlyph } from "../ink-tool-icons";

const SVG =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

const PATHS: Record<InkToolGlyph, string[]> = {
  pen: ["M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z", "m15 5 4 4"],
  highlighter: ["m9 11-6 6v3h3l6-6", "m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"],
  eraser: [
    "m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21",
    "M22 21H7",
    "m5 11 9 9",
  ],
  lasso: [
    "M7 22a5 5 0 0 1-2-4",
    "M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1",
    "M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  ],
};

test("each ink tool renders its own paths in the shared glyph frame (12-11)", () => {
  for (const [tool, paths] of Object.entries(PATHS) as [InkToolGlyph, string[]][]) {
    const expected = SVG + paths.map((d) => `<path d="${d}"></path>`).join("") + "</svg>";
    assert.equal(renderToStaticMarkup(toolIcon(tool)), expected, tool);
  }
});
