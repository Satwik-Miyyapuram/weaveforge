import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTargetHighlightRects } from "../ui/pdf-reader/target-highlight-overlay";

function makeFakePage(spans: Array<{ text: string; left: number; top: number; width: number; height: number }>) {
  const pageRect = { left: 0, top: 0, width: 612, height: 792, right: 612, bottom: 792 };
  const spanElements = spans.map((s) => ({
    textContent: s.text,
    getBoundingClientRect: () => ({
      left: s.left,
      top: s.top,
      width: s.width,
      height: s.height,
      right: s.left + s.width,
      bottom: s.top + s.height,
    }),
  }));

  const textLayer = {
    querySelectorAll: (sel: string) => (sel === "span" ? spanElements : []),
  };

  const pageEl = {
    getBoundingClientRect: () => pageRect,
    closest: () => null,
    querySelector: (sel: string) => (sel === ".pdf-reader-textlayer" ? textLayer : null),
  };

  return pageEl as unknown as HTMLElement;
}

test("resolveTargetHighlightRects: matches figure caption by label", () => {
  const pageEl = makeFakePage([
    { text: "Some preceding paragraph text.", left: 72, top: 200, width: 300, height: 12 },
    { text: "Figure 1: Illustration of the network graph.", left: 72, top: 350, width: 250, height: 12 },
    { text: "Some following paragraph text.", left: 72, top: 400, width: 300, height: 12 },
  ]);

  const rects = resolveTargetHighlightRects(pageEl, { page: 1, y: 442, label: "Figure 1" }, 792);
  assert.equal(rects.length, 1);
  assert.equal(rects[0]?.left, 72);
  assert.equal(rects[0]?.top, 350);
  assert.equal(rects[0]?.width, 250);
  assert.equal(rects[0]?.height, 12);
});

test("resolveTargetHighlightRects: matches footnote marker and line near expectedY", () => {
  const pageEl = makeFakePage([
    { text: "Paragraph text ending before footnotes.", left: 72, top: 600, width: 300, height: 12 },
    { text: "* Equal contribution by authors.", left: 72, top: 700, width: 200, height: 10 },
    { text: "1", left: 72, top: 720, width: 8, height: 8 },
    { text: "While it is common to refer to networks...", left: 82, top: 720, width: 320, height: 10 },
  ]);

  // y = 72 in PDF points => expectedY = (792 - 72) * 1 = 720
  const rects = resolveTargetHighlightRects(pageEl, { page: 1, y: 72, label: "1" }, 792);
  assert.equal(rects.length, 1);
  assert.equal(rects[0]?.left, 72);
  assert.equal(rects[0]?.top, 720);
  assert.equal(rects[0]?.width, 330); // Merged marker (72 to 80) + text (82 to 402)
  assert.equal(rects[0]?.height, 10);
});

test("resolveTargetHighlightRects: returns empty array if no spans match", () => {
  const pageEl = makeFakePage([]);
  const rects = resolveTargetHighlightRects(pageEl, { page: 1, y: 100 }, 792);
  assert.deepEqual(rects, []);
});
