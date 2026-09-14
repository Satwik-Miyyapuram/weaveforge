import assert from "node:assert/strict";
import test from "node:test";

import {
  FIGURE_ALT,
  figureAltFor,
  formatFigureTokens,
  inkPageFigures,
  parseFigureTokens,
  withInkPageFigures,
} from "../../src/ink/figure.js";

test("tokens round-trip: a box and its crop come back as they are written", () => {
  const geometry = { x: 120, y: 80.5, w: 600, h: 400, crop: [0, 5, 0, 10] as [number, number, number, number] };
  const tokens = formatFigureTokens(geometry);
  assert.equal(tokens, "x=120 y=80.5 w=600 h=400 c=0,5,0,10");
  const parsed = parseFigureTokens(`${FIGURE_ALT} ${tokens}`);
  assert.deepEqual(parsed, geometry);
});

test("a placement needs its whole box; unknown tokens are not an error", () => {
  assert.equal(parseFigureTokens("figure photo w=600"), null);
  assert.equal(parseFigureTokens("figure x=0 y=0 w=600 h=0"), null);
  assert.equal(parseFigureTokens("note the x=1 in prose and y=2 too"), null);
  // An alt with words and a complete box is still a figure.
  assert.ok(parseFigureTokens("right margin x=10 y=10 w=50 h=50"));
  // A junk crop is dropped, not fatal.
  const parsed = parseFigureTokens("figure x=1 y=2 w=3 h=4 c=oops");
  assert.deepEqual(parsed, { x: 1, y: 2, w: 3, h: 4 });
});

test("crop insets are clamped to their percentage range", () => {
  const parsed = parseFigureTokens("figure x=1 y=2 w=3 h=4 c=-5,50,150,3");
  assert.deepEqual(parsed?.crop, [0, 50, 99, 3]);
});

test("a page's figures are read in line order, background excluded", () => {
  const text = [
    "![page background](vault:bg.png)",
    "",
    "![figure x=10 y=20 w=100 h=80](vault:a.png)",
    "![figure x=200 y=20 w=100 h=80 c=0,10,0,10](vault:b.png)",
    "",
    "the recognised text",
  ].join("\n");
  const figures = inkPageFigures(text);
  assert.equal(figures.length, 2);
  assert.equal(figures[0]!.path, "a.png");
  assert.deepEqual(figures[1]!.crop, [0, 10, 0, 10]);
});

test("withInkPageFigures replaces the block, keeps the background and the text", () => {
  const start = [
    "![page background](vault:bg.png)",
    "",
    "![figure x=10 y=20 w=100 h=80](vault:old.png)",
    "",
    "hello",
    "world",
  ].join("\n");
  const next = withInkPageFigures(start, [
    { path: "new.png", x: 10, y: 20, w: 100, h: 80 },
    { path: "two.png", x: 10, y: 200, w: 100, h: 80, crop: [5, 5, 5, 5] },
  ]);
  assert.equal(next, [
    "![page background](vault:bg.png)",
    "",
    "![figure x=10 y=20 w=100 h=80](vault:new.png)",
    "![figure x=10 y=200 w=100 h=80 c=5,5,5,5](vault:two.png)",
    "",
    "hello",
    "world",
  ].join("\n"));
  // Clearing is removal, not an empty block.
  const cleared = withInkPageFigures(next, []);
  assert.equal(cleared, "![page background](vault:bg.png)\n\nhello\nworld");
  // An empty page gets its first figures without a stray leading blank.
  const first = withInkPageFigures("", [
    { path: "a.png", x: 0, y: 0, w: 10, h: 10 },
  ]);
  assert.equal(first, "![figure x=0 y=0 w=10 h=10](vault:a.png)");
});

test("withInkPageFigures re-applies over recognition's wholesale write", () => {
  // The recogniser hands back text that knows nothing of the host's figures;
  // the host keeps the figures and re-applies them over the new text.
  const figures = [{ path: "f.png" as const, x: 1, y: 2, w: 3, h: 4 }];
  const before = withInkPageFigures("old text", figures);
  assert.deepEqual(inkPageFigures(before), figures);
  const recognised = "line one\nline two";
  const reApplied = withInkPageFigures(recognised, figures);
  // The same figures over new text: one block, no duplication.
  assert.equal(
    reApplied,
    "![figure x=1 y=2 w=3 h=4](vault:f.png)\n\nline one\nline two",
  );
  assert.equal(inkPageFigures(reApplied).length, 1);
});

test("figureAltFor reads a path's alt from a whole body", () => {
  const body = [
    "![page background](vault:bg.png)",
    "![figure x=1 y=2 w=3 h=4](vault:f.png)",
    "![plain alt](vault:p.png)",
  ].join("\n");
  assert.equal(figureAltFor(body, "f.png"), "figure x=1 y=2 w=3 h=4");
  assert.equal(figureAltFor(body, "p.png"), null);
  assert.equal(figureAltFor(body, "missing.png"), null);
});
