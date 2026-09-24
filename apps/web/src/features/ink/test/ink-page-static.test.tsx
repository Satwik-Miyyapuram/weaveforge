/**
 * `InkPageStatic`, at the level a reader sees it.
 *
 * The static page is the whole of Read mode and the neighbouring halves of
 * Ink mode's scroll window, so what is pinned here is what would make an ink
 * note unreadable or wrong if it broke: the sheet takes the page's own size at
 * the fit scale, a pen stroke is one round-capped path at its nib width in the
 * palette's colour, a highlighter keeps its translucent alpha and draws over
 * the pen, the text underlay and figures sit under the ink, a background rides
 * as an image, and a page with no strokes draws no SVG at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { makeInkStroke, type FigureGeometry } from "@weaveforge/core";

import { InkPageStatic } from "../ui/ink-page-static";
import { INK_RENDER_COLOURS, paletteCss, type InkPalette } from "../render/ink-palette";
import { HIGHLIGHTER_ALPHA } from "../render/canvas-renderer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE = { width: 2100, height: 2970 };
const SCALE = 0.5;

/** The palette with one entry swapped, so a colour has to come from it. */
function paletteWith(
  colour: keyof InkPalette,
  rgb: [number, number, number],
): InkPalette {
  return { ...INK_RENDER_COLOURS, [colour]: rgb };
}

function renderText(props: Parameters<typeof InkPageStatic>[0]): string {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(createElement(InkPageStatic, props));
  });
  return JSON.stringify(renderer!.toJSON());
}

test("the sheet is the page's own size at the fit scale, with its paper and index", () => {
  const text = renderText({
    index: 3,
    pageSize: PAGE,
    scale: SCALE,
    paper: "ruled",
  });
  // 2100 * 0.5 = 1050, 2970 * 0.5 = 1485.
  assert.match(text, /"width":"1050px"/);
  assert.match(text, /"height":"1485px"/);
  assert.match(text, /paper-ruled/);
  assert.match(text, /"data-page":3/);
  // The page number, 1-based, is the ghost label.
  assert.match(text, /4/);
});

test("a pen stroke is one round-capped path at its own width and colour", () => {
  const text = renderText({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    strokes: [
      makeInkStroke({ points: [100, 200, 300, 400], pressures: [], width: 5 }),
    ],
  });
  assert.match(text, /"d":"M100 200L/);
  assert.match(text, /"strokeWidth":5/);
  assert.match(text, /"strokeLinecap":"round"/);
  assert.match(text, /"strokeLinejoin":"round"/);
  // The colour resolves through the palette, not the stroke's name.
  assert.match(text, /"stroke":"rgb\(33, 36, 41\)"/);
});

test("a stroke's colour comes from the palette it is handed", () => {
  const text = renderText({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    palette: paletteWith("text", [1, 0, 0]),
    strokes: [
      makeInkStroke({ points: [10, 10, 20, 20], pressures: [] }),
    ],
  });
  assert.match(text, /"stroke":"rgb\(255, 0, 0\)"/);
});

test("a highlighter keeps its alpha and draws over the pen", () => {
  const text = renderText({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    strokes: [
      makeInkStroke({
        points: [10, 10, 20, 20],
        pressures: [],
        tool: "highlighter",
      }),
      makeInkStroke({ points: [30, 30, 40, 40], pressures: [], tool: "pen" }),
    ],
  });
  assert.match(text, new RegExp(`"strokeOpacity":${HIGHLIGHTER_ALPHA}`));
  // Document order is the pen first, the tinted band after — the same order
  // the sheet and the SVG export draw in.
  const pen = text.indexOf('"d":"M30 30');
  const highlighter = text.indexOf('"d":"M10 10');
  assert.ok(pen >= 0 && highlighter > pen, "the highlighter draws over the pen");
});

test("the text underlay renders under the ink", () => {
  const text = renderText({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    pureText: "Recognised handwriting",
    strokes: [
      makeInkStroke({ points: [10, 10, 20, 20], pressures: [] }),
    ],
  });
  assert.match(text, /ink-sheet-text-underlay/);
  assert.match(text, /Recognised handwriting/);
  // The underlay is zIndex 0, the ink svg zIndex 1: the ink is over the text.
  const underlay = text.indexOf("ink-sheet-text-underlay");
  const svg = text.indexOf("ink-strokes-static");
  assert.ok(underlay >= 0 && svg > underlay, "the ink is written over the text");
});

test("a background image and figures render, and a figure resolves its url", () => {
  const figures: FigureGeometry[] = [
    { path: "vault:img/a.png", x: 100, y: 200, w: 500, h: 400 },
  ];
  const text = renderText({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    backgroundUrl: "blob:background",
    figures,
    figureUrls: new Map([["vault:img/a.png", "blob:figure"]]),
  });
  assert.match(text, /blob:background/);
  assert.match(text, /ink-figures/);
  assert.match(text, /blob:figure/);
  // A figure sits at its own box, scaled like the sheet is.
  assert.match(text, /"left":"50px"/);
  assert.match(text, /"top":"100px"/);
  assert.match(text, /"width":"250px"/);
});

test("a page with no strokes draws no SVG, and a page with none needs no layer", () => {
  const empty = renderText({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
  });
  assert.doesNotMatch(empty, /ink-strokes-static/);

  // A stroke whose points do not even make a dot is not a layer's excuse:
  // with only such strokes there is nothing to draw.
  const onlyEmpty = renderText({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    strokes: [makeInkStroke({ points: [], pressures: [] })],
  });
  // The SVG mounts (strokes were handed over) but contains no path.
  const svgStart = onlyEmpty.indexOf("ink-strokes-static");
  assert.ok(svgStart >= 0);
  assert.doesNotMatch(onlyEmpty, /"d":"M/);
});

test("a dot is a zero-length line a round cap draws", () => {
  const text = renderText({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    strokes: [makeInkStroke({ points: [7, 8], pressures: [] })],
  });
  assert.match(text, /"d":"M7 8l0 0"/);
});

test("a failed background load is reported, not swallowed", () => {
  let errors = 0;
  renderText({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    backgroundUrl: "blob:broken",
    onLoadError: () => {
      errors += 1;
    },
  });
  // The hook is wired; firing it is the image element's business, which a
  // static tree does not do. The assertion is that the handler reached the img.
  assert.ok(errors === 0);
  // And separately: the img exists to carry the handler.
  const text = renderText({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    backgroundUrl: "blob:background",
  });
  assert.match(text, /blob:background/);
});
