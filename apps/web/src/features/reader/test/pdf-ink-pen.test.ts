import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { ReaderAnnotation } from "@weaveforge/core";
import {
  appendInkStroke,
  draftInkAnnotation,
  eraseInkPaths,
  projectPageAnnotationGeometry,
  type CombinedPdfAnchor,
} from "@weaveforge/wasm";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { readFileSync } from "node:fs";
import { HIGHLIGHTER_ALPHA } from "@/features/ink/render/canvas-renderer";
import {
  PEN_UNITS_PER_PT,
  WetInkClear,
  clientToPenUnits,
  pdfPenMounts,
  pdfPenPages,
  penPointsToPdfPath,
  penViewportScale,
} from "../application/pdf-ink-pen";

// The PDF reader draws with the notes' pen: the worker gets page units
// (0.1 mm) from `clientToPenUnits`, and a committed stroke comes back through
// `penPointsToPdfPath` into the reader's existing save (`draftInkAnnotation` /
// `appendInkStroke`). These tests pin that the round trip loses nothing.

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

const proj = (rotation: number, scale: number) => ({ pageWidth: 600, pageHeight: 800, scale, rotation });

test("a pen point lands where the reader's own projection puts it, at every rotation", () => {
  for (const rotation of [0, 90, 180, 270]) {
    for (const scale of [1, 1.75]) {
      const p = proj(rotation, scale);
      const size = rs.projectedPageSize(p);
      const box = { left: 40, top: 300, width: size.width ?? 0, height: size.height ?? 0 };
      const css = [
        [1, 2],
        [box.width / 2, box.height / 3],
        [box.width - 1, box.height - 1],
      ];
      // What the worker reports: float32 page units.
      const units = new Float32Array(css.length * 2);
      css.forEach(([x, y], i) => {
        const u = clientToPenUnits(box.left + x!, box.top + y!, box, scale);
        assert.ok(u);
        units[i * 2] = u.x;
        units[i * 2 + 1] = u.y;
      });
      const path = penPointsToPdfPath(units, scale, (x, y) => rs.screenPointToPdf(x, y, p));
      css.forEach(([x, y], i) => {
        const direct = rs.screenPointToPdf(x!, y!, p);
        assert.ok(Math.abs(path[i * 2]! - direct.x) < 1e-3, `x at ${rotation}/${scale}`);
        assert.ok(Math.abs(path[i * 2 + 1]! - direct.y) < 1e-3, `y at ${rotation}/${scale}`);
      });
    }
  }
});

test("off the page box the pen has no point", () => {
  const box = { left: 10, top: 10, width: 100, height: 200 };
  assert.equal(clientToPenUnits(9, 50, box, 1), null);
  assert.equal(clientToPenUnits(50, 211, box, 1), null);
  assert.deepEqual(clientToPenUnits(10, 10, box, 2), { x: 0, y: 0 });
});

test("the worker draws page units at the reader's zoom", () => {
  // A point `u` units in is `u * viewportScale` CSS px in: the reader's pt * scale.
  const scale = 1.5;
  const u = clientToPenUnits(30, 0, { left: 0, top: 0, width: 600, height: 600 }, scale)!;
  assert.ok(Math.abs(u.x * penViewportScale(scale) - 30) < 1e-9);
  assert.ok(Math.abs(PEN_UNITS_PER_PT - 254 / 72) < 1e-12);
});

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const k = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

function maxDrift(raw: number[], saved: number[]): number {
  let worst = 0;
  for (let i = 0; i < raw.length; i += 2) {
    let best = Infinity;
    for (let j = 2; j < saved.length; j += 2) {
      best = Math.min(best, segDist(raw[i]!, raw[i + 1]!, saved[j - 2]!, saved[j - 1]!, saved[j]!, saved[j + 1]!));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

const arc: number[] = [];
for (let i = 0; i <= 120; i += 1) {
  const a = (i / 120) * Math.PI;
  arc.push(200 + 50 * Math.cos(a), 300 + 50 * Math.sin(a));
}

function drawnThroughPen(path: number[], rotation: number, scale: number): number[] {
  const p = proj(rotation, scale);
  const size = rs.projectedPageSize(p);
  const box = { left: 0, top: 0, width: size.width ?? 0, height: size.height ?? 0 };
  const units = new Float32Array(path.length);
  for (let i = 0; i < path.length; i += 2) {
    const css = rs.pdfPointToScreen(path[i]!, path[i + 1]!, p);
    const u = clientToPenUnits(css.x, css.y, box, scale)!;
    units[i] = u.x;
    units[i + 1] = u.y;
  }
  return penPointsToPdfPath(units, scale, (x, y) => rs.screenPointToPdf(x, y, p));
}

test("the saved stroke is the drawn stroke, with no jump at pen-down or pen-up", () => {
  for (const rotation of [0, 90]) {
    const drawn = drawnThroughPen(arc, rotation, 1.25);
    const draft = draftInkAnnotation({ color: "#000", pageIndex: 0, pageHeight: 800, path: drawn, width: 2 });
    const saved = draft?.anchor.zoteroPosition?.paths?.[0] ?? [];
    assert.ok(saved.length >= 4);
    assert.ok(maxDrift(drawn, saved) <= 0.11, `drift at ${rotation}`);
    // Pen-down and pen-up: the ends are where the pen touched and lifted.
    assert.ok(Math.hypot(saved[0]! - drawn[0]!, saved[1]! - drawn[1]!) < 1e-3, "start");
    const n = saved.length;
    const m = drawn.length;
    assert.ok(Math.hypot(saved[n - 2]! - drawn[m - 2]!, saved[n - 1]! - drawn[m - 1]!) < 1e-3, "end");
    // And both are within float32 of the true drawn arc.
    assert.ok(Math.hypot(saved[0]! - arc[0]!, saved[1]! - arc[1]!) < 1e-3);
  }
});

test("a stroke joining the mark in hand keeps its ends too", () => {
  const drawn = drawnThroughPen(arc, 0, 1);
  const first = draftInkAnnotation({ color: "#000", pageIndex: 0, pageHeight: 800, path: drawn, width: 2 });
  const next = appendInkStroke(first!.anchor, drawn);
  const saved = next?.zoteroPosition?.paths?.[1] ?? [];
  assert.ok(maxDrift(drawn, saved) <= 0.11);
  assert.ok(Math.hypot(saved[0]! - drawn[0]!, saved[1]! - drawn[1]!) < 1e-3);
});

test("the eraser and the lasso work on a pen stroke", () => {
  const drawn = drawnThroughPen(arc, 0, 1);
  const anchor = draftInkAnnotation({ color: "#000", pageIndex: 0, pageHeight: 800, path: drawn, width: 2 })!.anchor;
  const paths = anchor.zoteroPosition!.paths!;
  // Top of the arc is (200, 350).
  assert.equal(rs.inkPathsHitTest(paths, 200, 350, 2), true);
  assert.equal(rs.inkPathsHitTest(paths, 200, 300, 2), false);
  const erased = eraseInkPaths(anchor, 200, 350, 3);
  assert.notEqual(erased, anchor, "the eraser cut the stroke");
  assert.equal(rs.inkPathsInPolygon(paths, [140, 290, 260, 290, 260, 360, 140, 360]), true);
  assert.equal(rs.inkPathsInPolygon(paths, [0, 0, 10, 0, 10, 10, 0, 10]), false);
});

test("existing Zotero ink, which has no pressure, still renders", () => {
  const anchor: CombinedPdfAnchor = {
    zoteroPosition: { pageIndex: 0, width: 2, paths: [[100, 100, 120, 110, 140, 100]] },
  };
  const ann: ReaderAnnotation = {
    id: "z1",
    origin: "zotero",
    zoteroKey: "ABCD1234",
    type: "ink",
    color: "#000000",
    text: "",
    comment: "",
    tags: [],
    sortIndex: "00000|000000|00000",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    anchor,
  } as ReaderAnnotation;
  const { strokes } = projectPageAnnotationGeometry({
    annotations: [ann],
    pageNumber: 1,
    scale: 1,
    pageHeight: 792,
    pageWidth: 612,
    rotation: 0,
    contentHash: "",
  });
  assert.equal(strokes.length, 1);
});

test("the margin strip beside the page takes ink, measured from the page's corner", () => {
  const page = { left: 10, top: 10, width: 100, height: 200 };
  const row = { left: 10, top: 10, width: 160, height: 200 };
  assert.deepEqual(clientToPenUnits(140, 10, page, 1, row), { x: 130 * PEN_UNITS_PER_PT, y: 0 });
  assert.equal(clientToPenUnits(171, 50, page, 1, row), null);
  assert.equal(clientToPenUnits(140, 10, page, 1), null, "without the strip the page box is the edge");
});

test("the pen's nib and the stored nib are one width", () => {
  for (const w of [2, 5, 13, 40]) {
    const pt = rs.inkNoteWidthToPdfPoints(w);
    // Stored to 0.01 pt, so within half of that.
    assert.ok(Math.abs(pt * PEN_UNITS_PER_PT - w) <= 0.005 * PEN_UNITS_PER_PT + 1e-9, `width ${w}`);
  }
});

test("only the drawing tools put the pen on a page; picture and selection drags keep the page", () => {
  assert.equal(pdfPenMounts(true, true, "ink"), true);
  assert.equal(pdfPenMounts(true, true, "highlighter"), true);
  for (const tool of ["select", "lasso", "image", "text", "erase", "highlight", "underline", "note"]) {
    assert.equal(pdfPenMounts(true, true, tool), false, tool);
  }
  assert.equal(pdfPenMounts(false, true, "ink"), false);
  assert.equal(pdfPenMounts(true, false, "ink"), false);
});

test("every page on screen carries a pen, not only the current one and its neighbours", () => {
  const ratios = new Map([
    [4, 0.2],
    [5, 1],
    [6, 0.6],
    [7, 0.05],
    [9, 0],
  ]);
  assert.deepEqual([...pdfPenPages(ratios, 5, 10)].sort((a, b) => a - b), [4, 5, 6, 7]);
  assert.deepEqual([...pdfPenPages(new Map(), 1, 3)].sort((a, b) => a - b), [1, 2]);
});

test("a short saved mark ends where its wet stroke ended (< 0.3 pt)", () => {
  const short = [100, 100, 101, 100.5, 102.2, 101.1];
  const drawn = drawnThroughPen(short, 0, 2);
  const saved = draftInkAnnotation({ color: "#000", pageIndex: 0, pageHeight: 800, path: drawn, width: 2 })!.anchor
    .zoteroPosition!.paths![0]!;
  const n = saved.length;
  assert.ok(Math.hypot(saved[n - 2]! - 102.2, saved[n - 1]! - 101.1) < 0.3);
});

test("wet ink stays until its save resolves", () => {
  let cleared = 0;
  const wet = new WetInkClear(() => (cleared += 1), () => false);
  wet.saving();
  assert.equal(cleared, 0, "cleared before the save landed");
  wet.saved();
  assert.equal(cleared, 1);
  wet.settle();
  assert.equal(cleared, 1, "nothing new to clear");
});

test("a newer stroke keeps its preview while an older one saves", () => {
  let cleared = 0;
  let down = false;
  const wet = new WetInkClear(() => (cleared += 1), () => down);
  wet.saving(); // stroke A
  down = true; // stroke B starts
  wet.saved(); // A lands mid-B
  assert.equal(cleared, 0, "B's wet ink was wiped");
  down = false;
  wet.saving(); // B commits
  assert.equal(cleared, 0);
  wet.saved();
  assert.equal(cleared, 1);
});

test("a failed save keeps its wet ink, even after a later save lands", () => {
  let cleared = 0;
  const wet = new WetInkClear(() => (cleared += 1), () => false);
  wet.saving(); // stroke A
  wet.saving(); // stroke B
  wet.failed(); // A did not land: only the wet ink shows it
  wet.saved(); // B lands
  assert.equal(cleared, 0, "the unsaved stroke was wiped");
  wet.settle();
  assert.equal(cleared, 0);
});

test("the PDF pen writes with the notes' module only", () => {
  const sources = ["../ui/pdf-reader/pdf-ink-pen.tsx", "../application/pdf-ink-pen.ts"].map((f) =>
    readFileSync(new URL(f, import.meta.url), "utf8"),
  );
  const allowed = [/^react$/, /^@weaveforge\/core$/, /^@\/lib\/rust-core$/, /^@\/features\/ink\//, /^\.\.\/\.\.\/application\/pdf-ink-pen$/];
  for (const src of sources) {
    for (const m of src.matchAll(/from\s+"([^"]+)"/g)) {
      assert.ok(allowed.some((re) => re.test(m[1]!)), `PDF pen imports ${m[1]}`);
    }
    assert.doesNotMatch(src, /Sampler|getStroke|freedraw|NibFilter/, "PDF-only sampling or rendering");
  }
});

test("Ctrl+Z is not bound by the pen, so the reader's undo owns it", () => {
  for (const f of ["../../ink/ui/use-ink-pen.ts", "../../ink/application/use-pen-capture.ts", "../ui/pdf-reader/pdf-ink-pen.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /keydown|onKeyDown/, f);
  }
});

test("a PDF highlighter lets through what a notes' highlighter does, on screen and in print", () => {
  const css = readFileSync(new URL("../../../app/styles/reader.css", import.meta.url), "utf8");
  const rule = /\.pdf-reader-ink--highlighter\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.equal(Number(/opacity:\s*([\d.]+)/.exec(rule)?.[1]), HIGHLIGHTER_ALPHA);
  const print = readFileSync(new URL("../ui/pdf-reader/use-reader-print.ts", import.meta.url), "utf8");
  assert.match(print, /import \{ HIGHLIGHTER_ALPHA \} from "@\/features\/ink\/render\/canvas-renderer"/);
  assert.doesNotMatch(print, /const HIGHLIGHTER_ALPHA/);
});