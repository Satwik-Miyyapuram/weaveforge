import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust reader viewport, page projection and sort-index functions
// return exactly what the TS originals in packages/core/src/reader/ return.

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

type Rotation = 0 | 90 | 180 | 270;

/** Widens a test rotation to the typed union; invalid values reach both sides unchanged. */
const asRotation = (n: number): Rotation => n as Rotation;

/** Mulberry32, so a failure reproduces from the seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

const SPECIAL = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -0,
  0,
  0.5,
  1.5,
  -0.5,
  2.5,
  1e308,
  1e-9,
  0.25,
  4,
];

const ROTATIONS = [0, 90, 180, 270, 360, -90, 45, 44, 135, Number.NaN];

/** A number from the special list or a seeded spread around zero and the zoom range. */
function num(rand: () => number): number {
  const kind = rand();
  if (kind < 0.2) return SPECIAL[Math.floor(rand() * SPECIAL.length)]!;
  return (rand() - 0.3) * 40;
}

/** A positive-ish size, so most projections stay finite. */
function size(rand: () => number): number {
  return rand() < 0.1 ? num(rand) : rand() * 2000;
}

function page(rand: () => number): { width: number; height: number } {
  return { width: size(rand), height: size(rand) };
}

function projection(rand: () => number): {
  pageWidth: number;
  pageHeight: number;
  scale: number;
  rotation: number;
} {
  return {
    pageWidth: size(rand),
    pageHeight: size(rand),
    scale: rand() < 0.1 ? num(rand) : rand() * 4,
    rotation: ROTATIONS[Math.floor(rand() * ROTATIONS.length)]!,
  };
}

/** `Object.is` for scalars, so NaN and -0 count. */
function scalar(a: number | null, b: number | null, label: string): void {
  assert.ok(Object.is(a, b), `${label}: ts ${a} rs ${b}`);
}

test("clampScale: special and seeded scales match", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    for (const x of SPECIAL) scalar(ts.clampScale(x), rs.clampScale(x), `seed ${seed} clampScale special ${x}`);
    const x = num(rand);
    scalar(ts.clampScale(x), rs.clampScale(x), `seed ${seed} clampScale ${x}`);
  }
});

test("computeFitWidthScale and computeFitPageScale match across rotations and gutters", () => {
  const GUTTERS: (number | undefined)[] = [undefined, 0, 24, 1e308, -5, Number.NaN];
  for (const seed of SEEDS) {
    const rand = random(seed);
    const p = page(rand);
    const c = { width: size(rand), height: size(rand) };
    const rotation = seed % 11 === 0 ? undefined : asRotation(ROTATIONS[seed % ROTATIONS.length]!);
    const gutter = GUTTERS[seed % GUTTERS.length];
    scalar(
      ts.computeFitWidthScale(p, c, rotation, gutter),
      rs.computeFitWidthScale(p, c, rotation, gutter),
      `seed ${seed} fitWidth rot ${rotation} gutter ${gutter}`,
    );
    scalar(
      ts.computeFitPageScale(p, c, rotation, gutter),
      rs.computeFitPageScale(p, c, rotation, gutter),
      `seed ${seed} fitPage rot ${rotation} gutter ${gutter}`,
    );
  }
});

test("visualPageSize and nextRotation match", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const p = page(rand);
    for (const r of ROTATIONS) {
      assert.deepEqual(
        rs.visualPageSize(p, asRotation(r)),
        ts.visualPageSize(p, asRotation(r)),
        `seed ${seed} visualPageSize rot ${r}`,
      );
      const delta = seed % 3 === 0 ? undefined : seed % 2 === 0 ? 90 : -90;
      assert.deepEqual(
        rs.nextRotation(asRotation(r), delta),
        ts.nextRotation(asRotation(r), delta),
        `seed ${seed} nextRotation ${r} delta ${delta}`,
      );
    }
  }
});

test("clampZoomFactor, zoomIn and zoomOut match on seeded factors and steps", () => {
  const STEPS: (number | undefined)[] = [undefined, 1.25, 2, 0, -1, Number.NaN, 0.5, 1e308];
  for (const seed of SEEDS) {
    const rand = random(seed);
    const factor = num(rand);
    const base = num(rand);
    scalar(
      ts.clampZoomFactor(factor, base),
      rs.clampZoomFactor(factor, base),
      `seed ${seed} clampZoomFactor ${factor} base ${base}`,
    );
    const step = STEPS[seed % STEPS.length];
    scalar(ts.zoomIn(base, step), rs.zoomIn(base, step), `seed ${seed} zoomIn ${base} step ${step}`);
    scalar(ts.zoomOut(base, step), rs.zoomOut(base, step), `seed ${seed} zoomOut ${base} step ${step}`);
  }
  for (const x of SPECIAL) {
    scalar(ts.clampZoomFactor(x, 1), rs.clampZoomFactor(x, 1), `special clampZoomFactor ${x}`);
    scalar(ts.clampZoomFactor(2, x), rs.clampZoomFactor(2, x), `special clampZoomFactor base ${x}`);
  }
});

test("clampPage matches on page numbers below 1, fractions and above the count", () => {
  const PAGES = [0, -3, -0.5, 0.4, 1.5, 2.5, 3.7, 99, 1e308, Number.NaN, Number.POSITIVE_INFINITY];
  const COUNTS = [0, -1, 1, 5, 3.7, 1e308, Number.NaN, Number.POSITIVE_INFINITY];
  for (const seed of SEEDS) {
    const rand = random(seed);
    const pageNo = seed % 2 === 0 ? PAGES[seed % PAGES.length]! : num(rand);
    const count = COUNTS[seed % COUNTS.length]!;
    scalar(ts.clampPage(pageNo, count), rs.clampPage(pageNo, count), `seed ${seed} clampPage ${pageNo} of ${count}`);
  }
});

test("resolveViewportScale matches for width, page and custom fit", () => {
  const FITS = ["width", "page", "custom"] as const;
  for (const seed of SEEDS) {
    const rand = random(seed);
    const state = {
      scale: num(rand),
      fit: FITS[seed % FITS.length]!,
      rotation: asRotation(ROTATIONS[seed % ROTATIONS.length]!),
    };
    const p = page(rand);
    const c = { width: size(rand), height: size(rand) };
    scalar(
      ts.resolveViewportScale(state, p, c),
      rs.resolveViewportScale(state, p, c),
      `seed ${seed} resolveViewportScale ${state.fit} scale ${state.scale} rot ${state.rotation}`,
    );
  }
});

test("initialReaderViewport matches on page numbers including undefined", () => {
  const PAGES: (number | undefined)[] = [undefined, 0, -2, 1, 2.6, 1e308, Number.NaN, Number.POSITIVE_INFINITY];
  for (const pageNo of PAGES) {
    assert.deepEqual(rs.initialReaderViewport(pageNo), ts.initialReaderViewport(pageNo), `initial ${pageNo}`);
  }
  for (const seed of SEEDS) {
    const pageNo = num(random(seed));
    assert.deepEqual(rs.initialReaderViewport(pageNo), ts.initialReaderViewport(pageNo), `seed ${seed} initial ${pageNo}`);
  }
});

test("normalisePageRotation matches on every test rotation and seeded angles", () => {
  for (const r of [...ROTATIONS, -180, 540, -270, 89.9, 90.5, -0]) {
    scalar(ts.normalisePageRotation(r), rs.normalisePageRotation(r), `normalisePageRotation ${r}`);
  }
  for (const seed of SEEDS) {
    const r = num(random(seed)) * 45;
    scalar(ts.normalisePageRotation(r), rs.normalisePageRotation(r), `seed ${seed} normalisePageRotation ${r}`);
  }
});

test("projectedPageSize, pdfPointToScreen and screenPointToPdf match on seeded projections", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const p = projection(rand);
    assert.deepEqual(rs.projectedPageSize(p), ts.projectedPageSize(p), `seed ${seed} projectedPageSize ${p.rotation}`);
    for (let i = 0; i < 4; i += 1) {
      const x = num(rand);
      const y = num(rand);
      const a = ts.pdfPointToScreen(x, y, p);
      const b = rs.pdfPointToScreen(x, y, p);
      scalar(a.x, b.x, `seed ${seed} pdfPointToScreen ${i} x`);
      scalar(a.y, b.y, `seed ${seed} pdfPointToScreen ${i} y`);
      const c = ts.screenPointToPdf(x, y, p);
      const d = rs.screenPointToPdf(x, y, p);
      scalar(c.x, d.x, `seed ${seed} screenPointToPdf ${i} x`);
      scalar(c.y, d.y, `seed ${seed} screenPointToPdf ${i} y`);
    }
  }
});

test("pdfRectToScreenBox matches on seeded rects and rotations", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const p = projection(rand);
    const rect = [num(rand), num(rand), num(rand), num(rand)] as const;
    assert.deepEqual(
      rs.pdfRectToScreenBox(rect, p),
      ts.pdfRectToScreenBox(rect, p),
      `seed ${seed} pdfRectToScreenBox rot ${p.rotation} rect ${rect.join(",")}`,
    );
  }
});

test("buildAnnotationSortIndex matches on seeded and special inputs", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const pageIndex = num(rand);
    const offset = num(rand);
    const top = num(rand);
    assert.equal(
      rs.buildAnnotationSortIndex(pageIndex, offset, top),
      ts.buildAnnotationSortIndex(pageIndex, offset, top),
      `seed ${seed} sortIndex ${pageIndex} ${offset} ${top}`,
    );
  }
  for (const x of SPECIAL) {
    assert.equal(
      rs.buildAnnotationSortIndex(x, 0, 0),
      ts.buildAnnotationSortIndex(x, 0, 0),
      `special sortIndex page ${x}`,
    );
    assert.equal(
      rs.buildAnnotationSortIndex(3, x, 7),
      ts.buildAnnotationSortIndex(3, x, 7),
      `special sortIndex offset ${x}`,
    );
    assert.equal(
      rs.buildAnnotationSortIndex(3, 7, x),
      ts.buildAnnotationSortIndex(3, 7, x),
      `special sortIndex top ${x}`,
    );
  }
});
