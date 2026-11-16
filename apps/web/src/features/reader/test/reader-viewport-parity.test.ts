import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// The reader viewport, page projection and sort-index functions run in Rust
// only. The expectations below are the literal values the Rust #[test]s in
// crates/wf-core/src/reader/viewport.rs pin, so the web side proves the wasm
// bridge returns them unchanged.

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

/** A 600 x 800 page at the given rotation, at scale 1 unless overridden. */
const proj = (rotation: number, scale = 1) => ({
  pageWidth: 600,
  pageHeight: 800,
  scale,
  rotation,
});

test("initialReaderViewport starts at fit-width, rotation 0, scale 1 on the given page", () => {
  assert.deepEqual(rs.initialReaderViewport(3), { scale: 1, fit: "width", rotation: 0, page: 3 });
});

test("buildAnnotationSortIndex matches Zotero's zero-padded page|offset|top shape", () => {
  assert.equal(rs.buildAnnotationSortIndex(8, 412, 574.9), "00008|000412|00574");
  assert.equal(rs.buildAnnotationSortIndex(0, 0, 0), "00000|000000|00000");
  assert.equal(rs.buildAnnotationSortIndex(-3, -1, -0.5), "00000|000000|00000");
  assert.equal(rs.buildAnnotationSortIndex(Number.NaN, 0, 0), "00NaN|000000|00000");
  assert.equal(rs.buildAnnotationSortIndex(0, Number.POSITIVE_INFINITY, 0), "00000|Infinity|00000");
  assert.equal(rs.buildAnnotationSortIndex(1e21, 0, 0), "1e+21|000000|00000");
});

test("buildAnnotationSortIndex sorts lexically in reading order", () => {
  const keys = [
    rs.buildAnnotationSortIndex(1, 10, 100),
    rs.buildAnnotationSortIndex(0, 999, 50),
    rs.buildAnnotationSortIndex(1, 2, 200),
  ].sort();
  assert.deepEqual(keys, [
    rs.buildAnnotationSortIndex(0, 999, 50),
    rs.buildAnnotationSortIndex(1, 2, 200),
    rs.buildAnnotationSortIndex(1, 10, 100),
  ]);
});

test("normalisePageRotation folds any angle onto the four quarter turns", () => {
  assert.equal(rs.normalisePageRotation(0), 0);
  assert.equal(rs.normalisePageRotation(360), 0);
  assert.equal(rs.normalisePageRotation(-90), 270);
  assert.equal(rs.normalisePageRotation(450), 90);
  assert.equal(rs.normalisePageRotation(Number.NaN), 0);
  assert.equal(rs.normalisePageRotation(Number.POSITIVE_INFINITY), 0);
  // JS Math.round rounds halves up, so 45 lands on 90 and 44 on 0.
  assert.equal(rs.normalisePageRotation(45), 90);
  assert.equal(rs.normalisePageRotation(44), 0);
});

test("projectedPageSize swaps the axes on a quarter turn", () => {
  assert.deepEqual(rs.projectedPageSize(proj(0)), { width: 600, height: 800 });
  assert.deepEqual(rs.projectedPageSize(proj(90)), { width: 800, height: 600 });
  assert.deepEqual(rs.projectedPageSize(proj(180)), { width: 600, height: 800 });
  assert.deepEqual(rs.projectedPageSize(proj(270)), { width: 800, height: 600 });
});

test("pdfPointToScreen flips the origin at 0 degrees", () => {
  assert.deepEqual(rs.pdfPointToScreen(0, 0, proj(0)), { x: 0, y: 800 });
  assert.deepEqual(rs.pdfPointToScreen(0, 800, proj(0)), { x: 0, y: 0 });
  assert.deepEqual(rs.pdfPointToScreen(10, 800, proj(0, 2)), { x: 20, y: 0 });
});

test("pdfPointToScreen keeps a page corner inside the page box at every rotation", () => {
  const corners = [
    [0, 0],
    [600, 0],
    [0, 800],
    [600, 800],
  ] as const;
  for (const rotation of [0, 90, 180, 270]) {
    const p = proj(rotation);
    const s = rs.projectedPageSize(p);
    for (const [x, y] of corners) {
      const q = rs.pdfPointToScreen(x, y, p);
      assert.ok(q.x >= -1e-6 && q.x <= (s.width ?? 0) + 1e-6, `x at ${rotation}`);
      assert.ok(q.y >= -1e-6 && q.y <= (s.height ?? 0) + 1e-6, `y at ${rotation}`);
    }
  }
});

test("screenPointToPdf inverts pdfPointToScreen at every rotation and scale", () => {
  for (const rotation of [0, 90, 180, 270]) {
    for (const scale of [1, 1.75]) {
      const p = proj(rotation, scale);
      for (const [x, y] of [
        [10, 20],
        [599, 799],
        [300, 400],
      ] as const) {
        const screen = rs.pdfPointToScreen(x, y, p);
        const back = rs.screenPointToPdf(screen.x, screen.y, p);
        assert.ok(Math.abs(back.x - x) < 1e-9 && Math.abs(back.y - y) < 1e-9);
      }
    }
  }
});

test("pdfRectToScreenBox normalises corners that a quarter turn swapped", () => {
  const box = rs.pdfRectToScreenBox([100, 700, 300, 750] as const, proj(90));
  assert.deepEqual(box, { left: 700, top: 100, width: 50, height: 200 });
});
