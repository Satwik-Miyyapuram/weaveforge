/**
 * The SVG export (§4.8's page, as vectors).
 *
 * What is asserted is the shape of the document rather than a byte-for-byte
 * string: that a page comes out A4 wide in millimetres over a 0.1 mm viewBox —
 * so it prints at size and its numbers are the model's own — that each stroke is
 * one round-capped path at its own nib width and colour, that a highlighter
 * keeps its alpha, and that a background rides along as an embedded raster
 * rather than as a link that would die with the page.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  blankInkPage,
  makeInkStroke,
  type InkPage,
} from "@weaveforge/core";

import { inkPageSvg } from "../application/ink-svg";
import { INK_RENDER_COLOURS, type InkPalette } from "../render/ink-palette";
import { HIGHLIGHTER_ALPHA } from "../render/canvas-renderer";

function pageWith(...strokes: InkPage["strokes"]): InkPage {
  return { ...blankInkPage("blank"), strokes };
}

/** The palette with one entry swapped, so a colour has to come from it. */
function paletteWith(
  colour: keyof InkPalette,
  rgb: [number, number, number],
): InkPalette {
  return { ...INK_RENDER_COLOURS, [colour]: rgb };
}

test("a page is A4 in millimetres over a viewBox in the model's own unit", () => {
  const svg = inkPageSvg(pageWith());
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /width="210mm" height="297mm"/);
  assert.match(svg, new RegExp(`viewBox="0 0 ${INK_A4_WIDTH} ${INK_A4_HEIGHT}"`));
  // A sheet of paper behind everything, whatever the viewer's canvas is.
  assert.match(svg, /<rect x="0" y="0" width="2100" height="2970" fill="#ffffff"\/>/);
});

test("a stroke is one path, round-capped, at its own width and colour", () => {
  const svg = inkPageSvg(
    pageWith(
      makeInkStroke({ points: [100, 200, 300, 400], pressures: [], width: 5 }),
    ),
    // The stroke's colour is a *name*; the value comes from the palette.
    { palette: paletteWith("text", [1, 0, 0]) },
  );
  assert.match(svg, /<path d="M100 200L300 400"/);
  assert.match(svg, /stroke-width="5"/);
  assert.match(svg, /stroke-linecap="round"/);
  assert.match(svg, /stroke="rgb\(255, 0, 0\)"/);
});

test("a highlighter keeps its alpha and is drawn over the pen", () => {
  const svg = inkPageSvg(
    pageWith(
      makeInkStroke({
        points: [10, 10, 20, 20],
        pressures: [],
        tool: "highlighter",
      }),
      makeInkStroke({ points: [30, 30, 40, 40], pressures: [], tool: "pen" }),
    ),
  );
  assert.match(svg, new RegExp(`stroke-opacity="${HIGHLIGHTER_ALPHA}"`));
  const highlighter = svg.indexOf('stroke-opacity="0.35"');
  const pen = svg.indexOf("M30 30L40 40");
  // A highlighter tints writing it was laid on: the pen's path is written
  // first and the tinted band after it, which is what "over" means in SVG
  // document order.
  assert.ok(highlighter >= 0 && pen >= 0 && pen < highlighter, "the highlighter draws over the pen");
});

test("a page with an image embeds it; a page without one has no image", () => {
  const withImage = inkPageSvg(pageWith(), {
    backgroundDataUrl: "data:image/png;base64,AAAA",
  });
  assert.match(withImage, /<image x="0" y="0" width="2100" height="2970"/);
  // Embedded, not linked: a blob URL would be dead by the time the file is
  // opened again.
  assert.match(withImage, /xlink:href="data:image\/png;base64,AAAA"/);
  assert.doesNotMatch(inkPageSvg(pageWith()), /<image/);
});

test("a dot is a zero-length line, and a stroke with no points is nothing", () => {
  const svg = inkPageSvg(
    pageWith(
      makeInkStroke({ points: [7, 8], pressures: [] }),
      makeInkStroke({ points: [], pressures: [] }),
    ),
  );
  // A round cap draws the dot; an empty path would draw a scratch or nothing.
  assert.match(svg, /<path d="M7 8l0 0"/);
  assert.equal(svg.match(/<path /g)?.length, 1);
});

test("a title with markup in it cannot escape its element", () => {
  const svg = inkPageSvg(pageWith(), { title: 'a<b & "c"' });
  assert.match(svg, /<title>a&lt;b &amp; &quot;c&quot;<\/title>/);
});

test("figures embed under the strokes, and a crop clips rather than stretches", () => {
  const page = pageWith(
    makeInkStroke({ points: [10, 10, 20, 20], pressures: [] }),
  );
  const svg = inkPageSvg(page, {
    figures: [
      { path: "a.png", x: 100, y: 200, w: 500, h: 400, dataUrl: "data:image/webp;base64,AAAA" },
      {
        path: "b.png",
        x: 700,
        y: 200,
        w: 500,
        h: 400,
        crop: [10, 0, 10, 0],
        dataUrl: "data:image/webp;base64,BBBB",
      },
    ],
  });
  // Both figures are embedded as data URLs, never links.
  assert.match(svg, /xlink:href="data:image\/webp;base64,AAAA"/);
  assert.match(svg, /xlink:href="data:image\/webp;base64,BBBB"/);
  // An uncropped figure is drawn at exactly its own box.
  assert.match(
    svg,
    /<image x="100" y="200" width="500" height="400" preserveAspectRatio="none"/,
  );
  // A cropped figure is enlarged into a clip: keepX = 0.8, so a 500-unit box
  // draws 625 wide and sits 62.5 left of the box — the crop shows the middle.
  assert.match(svg, /<image x="637.5" y="200" width="625" height="400"/);
  assert.match(
    svg,
    /<clipPath id="figure-clip-700-200-500-400"><rect x="700" y="200" width="500" height="400"/,
  );
  // The writing goes over the pasted photo, as on the sheet.
  const figure = svg.indexOf("<image x=");
  const stroke = svg.indexOf("<path ");
  assert.ok(figure >= 0 && stroke > figure, "the strokes are written over the figures");
});

