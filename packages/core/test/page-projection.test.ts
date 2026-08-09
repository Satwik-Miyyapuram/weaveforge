import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalisePageRotation,
  pdfPointToScreen,
  pdfRectToScreenBox,
  projectedPageSize,
  screenPointToPdf,
  type PageProjection,
} from "../src/reader/page-projection.js";

const PAGE: Omit<PageProjection, "rotation"> = {
  pageWidth: 600,
  pageHeight: 800,
  scale: 1,
};

test("normalisePageRotation folds anything onto the four quarter turns", () => {
  assert.equal(normalisePageRotation(0), 0);
  assert.equal(normalisePageRotation(360), 0);
  assert.equal(normalisePageRotation(-90), 270);
  assert.equal(normalisePageRotation(450), 90);
});

test("projectedPageSize swaps the axes on a quarter turn", () => {
  assert.deepEqual(projectedPageSize({ ...PAGE, rotation: 0 }), { width: 600, height: 800 });
  assert.deepEqual(projectedPageSize({ ...PAGE, rotation: 90 }), { width: 800, height: 600 });
  assert.deepEqual(projectedPageSize({ ...PAGE, rotation: 180 }), { width: 600, height: 800 });
  assert.deepEqual(projectedPageSize({ ...PAGE, rotation: 270 }), { width: 800, height: 600 });
});

test("pdfPointToScreen flips the origin at 0 degrees", () => {
  // PDF origin is bottom-left, the DOM's is top-left.
  assert.deepEqual(pdfPointToScreen(0, 0, { ...PAGE, rotation: 0 }), { x: 0, y: 800 });
  assert.deepEqual(pdfPointToScreen(0, 800, { ...PAGE, rotation: 0 }), { x: 0, y: 0 });
});

test("pdfPointToScreen keeps a page corner in the page box at every rotation", () => {
  const corners: [number, number][] = [
    [0, 0],
    [600, 0],
    [0, 800],
    [600, 800],
  ];
  for (const rotation of [0, 90, 180, 270]) {
    const projection = { ...PAGE, rotation };
    const size = projectedPageSize(projection);
    for (const [x, y] of corners) {
      const point = pdfPointToScreen(x, y, projection);
      assert.ok(
        point.x >= -1e-6 && point.x <= size.width + 1e-6,
        `x out of the page at ${rotation}°: ${point.x}`,
      );
      assert.ok(
        point.y >= -1e-6 && point.y <= size.height + 1e-6,
        `y out of the page at ${rotation}°: ${point.y}`,
      );
    }
  }
});

test("screenPointToPdf inverts pdfPointToScreen at every rotation and scale", () => {
  for (const rotation of [0, 90, 180, 270]) {
    for (const scale of [1, 1.75]) {
      const projection = { ...PAGE, scale, rotation };
      for (const [x, y] of [[10, 20], [599, 799], [300, 400]] as [number, number][]) {
        const screen = pdfPointToScreen(x, y, projection);
        const back = screenPointToPdf(screen.x, screen.y, projection);
        assert.ok(
          Math.abs(back.x - x) < 1e-9 && Math.abs(back.y - y) < 1e-9,
          `round trip failed at ${rotation}°/${scale}×: (${x},${y}) → (${back.x},${back.y})`,
        );
      }
    }
  }
});

test("pdfRectToScreenBox normalises corners that rotation swapped", () => {
  const box = pdfRectToScreenBox([100, 700, 300, 750], { ...PAGE, rotation: 90 });
  assert.ok(box.width > 0 && box.height > 0);
  assert.deepEqual(box, { left: 700, top: 100, width: 50, height: 200 });
});

test("scale multiplies through the projection", () => {
  assert.deepEqual(pdfPointToScreen(10, 800, { ...PAGE, scale: 2, rotation: 0 }), {
    x: 20,
    y: 0,
  });
});
