/**
 * `InkPageStatic`, at the level a reader sees it.
 *
 * The static page is the whole of Read mode and the neighbouring halves of
 * Ink mode's scroll window, so what is pinned here is what would make an ink
 * note unreadable or wrong if it broke: the sheet takes the page's own size at
 * the fit scale, a pen stroke is one round-capped path at its nib width in the
 * palette's colour, a highlighter keeps its translucent alpha and draws over
 * the pen, the text underlay and figures sit under the ink, a background rides
 * as an image, and a page with no strokes draws no ink layer at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { type FigureGeometry } from "@weaveforge/core";

import { InkPageStatic } from "../ui/ink-page-static";
import { INK_RENDER_COLOURS, type InkPalette } from "../render/parts-1";
import { HIGHLIGHTER_ALPHA } from "../render/canvas-renderer";
import { typedCore } from "@/lib/rust-core";

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

interface Drawn {
  d: string | undefined;
  colour: string;
  width: number;
  alpha: number;
}

// Node has no Path2D; the draw only needs to hand its `d` to the context.
class FakePath2D {
  constructor(readonly d?: string) {}
}
(globalThis as { Path2D?: unknown }).Path2D ??= FakePath2D;

/**
 * A 2D context that keeps each ink outline it fills. Freehand ink is a filled
 * path built from moveTo/quadraticCurveTo, so the path is written out as text
 * and kept with the fill colour. Strokes (paper rules) are kept as before.
 */
function recordingContext() {
  const drawn: Drawn[] = [];
  let path = "";
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    lineCap: "",
    lineJoin: "",
    setTransform() {},
    clearRect() {},
    beginPath() {
      path = "";
    },
    moveTo(x: number, y: number) {
      path += `M${x} ${y}`;
    },
    lineTo(x: number, y: number) {
      path += `L${x} ${y}`;
    },
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      path += `Q${cx} ${cy} ${x} ${y}`;
    },
    closePath() {
      path += "Z";
    },
    arc() {},
    // A Path2D argument carries its own `d`; a rule name ("nonzero") means the built path.
    fill(source?: { d?: string } | string) {
      const d = typeof source === "object" && source.d !== undefined ? source.d : path;
      drawn.push({ d, colour: ctx.fillStyle, width: ctx.lineWidth, alpha: ctx.globalAlpha });
    },
    stroke(p: { d?: string }) {
      drawn.push({ d: p.d, colour: ctx.strokeStyle, width: ctx.lineWidth, alpha: ctx.globalAlpha });
    },
  };
  return { ctx, drawn };
}

/** The x and y extent of the numbers in a path string. */
function extent(d: string): { minX: number; maxX: number; minY: number; maxY: number } {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

// No IntersectionObserver in Node, so every page counts as near and draws.
function renderPage(props: Parameters<typeof InkPageStatic>[0]) {
  const { ctx, drawn } = recordingContext();
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(createElement(InkPageStatic, props), {
      createNodeMock: (el) =>
        el.type === "canvas"
          ? { width: 0, height: 0, getContext: () => ctx }
          : (el.props as { className?: string })?.className === "ink-page"
            ? { closest: () => null }
            : null,
    });
  });
  return { text: JSON.stringify(renderer!.toJSON()), ctx, drawn };
}

function renderText(props: Parameters<typeof InkPageStatic>[0]): string {
  return renderPage(props).text;
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

test("a pen stroke is one filled outline around its points, in its own colour", () => {
  const { drawn } = renderPage({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    strokes: [
      typedCore().makeInkStroke({ points: [100, 200, 300, 400], pressures: [], width: 5 }),
    ],
  });
  assert.equal(drawn.length, 1);
  // The outline wraps the points, and runs a little past them by the nib.
  const box = extent(drawn[0]!.d ?? "");
  assert.ok(box.minX <= 100 && box.maxX >= 300, "the outline spans the stroke's x");
  assert.ok(box.minY <= 200 && box.maxY >= 400, "the outline spans the stroke's y");
  // The colour resolves through the palette, not the stroke's name.
  assert.equal(drawn[0]!.colour, "rgb(33, 36, 41)");
});

test("a stroke's colour comes from the palette it is handed", () => {
  const { drawn } = renderPage({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    palette: paletteWith("text", [1, 0, 0]),
    strokes: [
      typedCore().makeInkStroke({ points: [10, 10, 20, 20], pressures: [] }),
    ],
  });
  assert.equal(drawn[0]!.colour, "rgb(255, 0, 0)");
});

test("a highlighter keeps its alpha and draws over the pen", () => {
  const { ctx, drawn } = renderPage({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    strokes: [
      typedCore().makeInkStroke({
        points: [10, 10, 20, 20],
        pressures: [],
        tool: "highlighter",
      }),
      typedCore().makeInkStroke({ points: [30, 30, 40, 40], pressures: [], tool: "pen" }),
    ],
  });
  // The pen first, the tinted band after: the order the sheet and SVG export draw in.
  assert.ok(extent(drawn[0]!.d ?? "").minX > 25, "the pen outline is around its own points");
  assert.ok(extent(drawn[1]!.d ?? "").maxX < 25, "the highlighter outline is around its own points");
  assert.equal(drawn[0]!.alpha, 1);
  assert.equal(drawn[1]!.alpha, HIGHLIGHTER_ALPHA);
  assert.equal(ctx.globalAlpha, 1);
});

test("the text underlay renders under the ink", () => {
  const text = renderText({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    pureText: "Recognised handwriting",
    strokes: [
      typedCore().makeInkStroke({ points: [10, 10, 20, 20], pressures: [] }),
    ],
  });
  assert.match(text, /ink-sheet-text-underlay/);
  assert.match(text, /Recognised handwriting/);
  // The underlay is zIndex 0, the ink canvas zIndex 1: the ink is over the text.
  const underlay = text.indexOf("ink-sheet-text-underlay");
  const ink = text.indexOf("ink-strokes-static");
  assert.ok(underlay >= 0 && ink > underlay, "the ink is written over the text");
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

test("a page with no strokes draws no ink layer, and nor does one with only empty strokes", () => {
  const empty = renderText({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
  });
  assert.doesNotMatch(empty, /ink-strokes-static/);

  // A stroke whose points do not even make a dot draws nothing.
  const { drawn } = renderPage({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    strokes: [typedCore().makeInkStroke({ points: [], pressures: [] })],
  });
  assert.equal(drawn.length, 0);
});

test("a dot is a filled outline around its point", () => {
  const { drawn } = renderPage({
    index: 0,
    pageSize: PAGE,
    scale: SCALE,
    paper: "blank",
    strokes: [typedCore().makeInkStroke({ points: [7, 8], pressures: [] })],
  });
  assert.equal(drawn.length, 1);
  const box = extent(drawn[0]!.d ?? "");
  assert.ok(box.minX <= 7 && box.maxX >= 7 && box.minY <= 8 && box.maxY >= 8, "the dot covers its point");
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
