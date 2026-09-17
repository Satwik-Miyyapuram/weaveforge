import assert from "node:assert/strict";
import test from "node:test";

import {
  FIGURE_ALT,
  figureAltFor,
  cropFigureTo,
  reorderFigures,
  resizeFigureBox,
  uncroppedFigureBox,
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

test("figure: z-order steps move within the block and stop at the ends", () => {
  const abc = ["a", "b", "c"];
  assert.deepEqual(reorderFigures(abc, 0, "front"), ["b", "c", "a"]);
  assert.deepEqual(reorderFigures(abc, 2, "back"), ["c", "a", "b"]);
  assert.deepEqual(reorderFigures(abc, 0, "forward"), ["b", "a", "c"]);
  assert.deepEqual(reorderFigures(abc, 2, "forward"), abc);
  assert.deepEqual(reorderFigures(abc, 0, "backward"), abc);
  assert.deepEqual(reorderFigures(abc, 1, "backward"), ["b", "a", "c"]);
  assert.deepEqual(reorderFigures(abc, 7, "front"), abc);
});

test("figure: an edge handle moves one side, a corner keeps the aspect", () => {
  const box = { x: 100, y: 100, w: 400, h: 200 };
  assert.deepEqual(resizeFigureBox(box, "e", 50, 999), { x: 100, y: 100, w: 450, h: 200 });
  assert.deepEqual(resizeFigureBox(box, "n", 999, -50), { x: 100, y: 50, w: 400, h: 250 });
  // South-east by +100 on x: the width wins, the height follows at 2:1.
  assert.deepEqual(resizeFigureBox(box, "se", 100, 10), { x: 100, y: 100, w: 500, h: 250 });
  // North-west anchors the far corner.
  assert.deepEqual(resizeFigureBox(box, "nw", -100, 0), { x: 0, y: 50, w: 500, h: 250 });
  // Free: a corner becomes a distortion.
  assert.deepEqual(resizeFigureBox(box, "se", 100, 10, { free: true }), { x: 100, y: 100, w: 500, h: 210 });
  // Nothing shrinks below the minimum.
  assert.deepEqual(resizeFigureBox(box, "w", 1000, 0, { free: true }).w, 30);
});

test("figure: the uncropped box and a crop inside it round-trip", () => {
  const figure = { x: 100, y: 100, w: 400, h: 200 };
  assert.deepEqual(uncroppedFigureBox(figure), figure);
  // Keep the right half: the box shrinks to it, the left inset is 50 %.
  const half = cropFigureTo(figure, { x: 300, y: 100, w: 200, h: 200 });
  assert.deepEqual(half, { x: 300, y: 100, w: 200, h: 200, crop: [50, 0, 0, 0] });
  // Lifting the crop puts the whole picture back where it was.
  assert.deepEqual(uncroppedFigureBox(half), figure);
  // Keeping everything clears the token.
  assert.equal("crop" in cropFigureTo(figure, figure), false);
});
