/**
 * Proves the Rust (wasm) reader ink-stroke functions return exactly what the TS
 * originals in `packages/core/src/reader/ink-stroke.ts` return on the same inputs,
 * including throws: seeded strokes plus numeric, string and empty-array edge cases.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { InkGroupCandidate } from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

// Rust and TS must agree exactly on the ink geometry, so the TS copy can be
// deleted. Strokes are seeded so a failure reproduces from the seed.

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

interface Sample {
  points: number[];
  pressures: number[];
}

/** A wandering pen stroke in 0.1 mm, with repeats, jumps and pressure. */
function stroke(rand: () => number, maxCount = 60): Sample {
  const count = Math.floor(rand() * maxCount);
  const points: number[] = [];
  const pressures: number[] = [];
  let x = rand() * 2000;
  let y = rand() * 2000;
  let heading = rand() * Math.PI * 2;
  for (let i = 0; i < count; i += 1) {
    const kind = rand();
    if (kind < 0.08) {
      // Pen held still: a repeated sample.
    } else if (kind < 0.12) {
      x += (rand() - 0.5) * 400;
      y += (rand() - 0.5) * 400;
    } else {
      heading += (rand() - 0.5) * 0.8;
      const step = rand() * 12;
      x += Math.cos(heading) * step;
      y += Math.sin(heading) * step;
    }
    points.push(rand() < 0.5 ? Math.round(x) : x, rand() < 0.5 ? Math.round(y) : y);
    pressures.push(rand() < 0.1 ? 0 : rand() * 255);
  }
  return { points, pressures };
}

// 200 seeds per family, each seed reproducible from its number.
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

const NUMS: number[] = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -0,
  0,
  0.5,
  1.5,
  -0.5,
  2.5,
  -2.5,
  0.125,
  -0.125,
  0.35,
  0.75,
  1e308,
  -1e308,
  1e-300,
];

const STRINGS: string[] = [
  "",
  "ink",
  " ",
  "  　﻿\t\n",
  "\u{1F600}",
  "é",
  "é",
];

type Outcome<T> = { threw: true } | { threw: false; value: T };

function outcome<T>(run: () => T): Outcome<T> {
  try {
    return { threw: false, value: run() };
  } catch {
    return { threw: true };
  }
}

/**
 * Both sides return the same value, or both throw. `deepStrictEqual` compares
 * primitives with `Object.is`, so NaN equals NaN and -0 differs from 0.
 */
function agree<T>(label: string, tsRun: () => T, rsRun: () => T): void {
  const a = outcome(tsRun);
  const b = outcome(rsRun);
  assert.equal(b.threw, a.threw, `${label}: threw ts ${a.threw} rs ${b.threw}`);
  if (a.threw || b.threw) return;
  assert.deepEqual(b.value, a.value, label);
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

test("width: note units, highlighter threshold and clamp match", () => {
  for (const n of NUMS) {
    agree(`inkNoteWidthToPdfPoints ${n}`, () => ts.inkNoteWidthToPdfPoints(n), () => rs.inkNoteWidthToPdfPoints(n));
    agree(`clampInkWidth ${n}`, () => ts.clampInkWidth(n), () => rs.clampInkWidth(n));
    agree(`isHighlighterInk ${n}`, () => ts.isHighlighterInk(n), () => rs.isHighlighterInk(n));
  }
  agree("isHighlighterInk undefined", () => ts.isHighlighterInk(undefined), () => rs.isHighlighterInk(undefined));
  for (const seed of SEEDS) {
    const rand = random(seed);
    const tenths = (rand() - 0.2) * 600;
    const width = rand() * 40 - 10;
    agree(`seed ${seed} inkNoteWidthToPdfPoints`, () => ts.inkNoteWidthToPdfPoints(tenths), () => rs.inkNoteWidthToPdfPoints(tenths));
    agree(`seed ${seed} isHighlighterInk`, () => ts.isHighlighterInk(width), () => rs.isHighlighterInk(width));
    agree(`seed ${seed} clampInkWidth`, () => ts.clampInkWidth(width), () => rs.clampInkWidth(width));
  }
});

test("pressure: width for pressure and mean ignore non-reporting samples", () => {
  const pressures: (number | undefined)[] = [undefined, ...NUMS, 0.25, 1 / 3, 1.5];
  const bases: (number | undefined)[] = [undefined, 0, -0, 0.1, 1, 2, 24, 100, Number.NaN, Number.POSITIVE_INFINITY];
  for (const p of pressures) {
    for (const base of bases) {
      agree(`inkWidthForPressure ${p} ${base}`, () => ts.inkWidthForPressure(p, base), () => rs.inkWidthForPressure(p, base));
    }
  }
  const sets: number[][] = [
    [],
    [0],
    [-0],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [-1],
    [0.5],
    [0.5, 1.5],
    [0, 0, 2],
    [1e308, 1e308],
    [-0, 3],
    [0.25, 0.75, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.1],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  ];
  for (const set of sets) {
    agree(`meanPressure ${set.join(",")}`, () => ts.meanPressure(set), () => rs.meanPressure(set));
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const s = stroke(rand);
    agree(`seed ${seed} meanPressure`, () => ts.meanPressure(s.pressures), () => rs.meanPressure(s.pressures));
    const p = rand() < 0.2 ? undefined : rand() * 1.4;
    const base = pick(rand, bases);
    agree(`seed ${seed} inkWidthForPressure`, () => ts.inkWidthForPressure(p, base), () => rs.inkWidthForPressure(p, base));
  }
});

const APPEND_PATHS: number[][] = [
  [],
  [5],
  [0, 0],
  [0, 0, 3, 4],
  [1, 2, 3],
  [Number.NaN, 1, 2, 3],
  [Number.POSITIVE_INFINITY, 0, 0, 0],
  [1, 1, 1, 1, 1, 1],
];

test("capture: append gate matches on edge points and distances", () => {
  const coords: number[] = [0, -0, Number.NaN, Number.POSITIVE_INFINITY, 3, 0.75, 1e308];
  const minDistances: (number | undefined)[] = [undefined, 0, -0, 0.75, 1, Number.NaN, Number.POSITIVE_INFINITY, -1];
  for (const path of APPEND_PATHS) {
    for (const x of coords) {
      for (const y of coords) {
        for (const d of minDistances) {
          agree(
            `shouldAppendInkPoint [${path}] ${x} ${y} ${d}`,
            () => ts.shouldAppendInkPoint(path, x, y, d),
            () => rs.shouldAppendInkPoint(path, x, y, d),
          );
        }
      }
    }
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const s = stroke(rand);
    const x = rand() * 40 - 20 + (s.points[0] ?? 0);
    const y = rand() * 40 - 20 + (s.points[1] ?? 0);
    const d = pick(rand, minDistances);
    agree(`seed ${seed} shouldAppendInkPoint`, () => ts.shouldAppendInkPoint(s.points, x, y, d), () => rs.shouldAppendInkPoint(s.points, x, y, d));
  }
});

// Simplifier inputs. Odd-length and zero-length-segment paths are included on purpose.
const SIMPLIFY_PATHS: number[][] = [
  [],
  [1],
  [1, 2],
  [1, 2, 3, 4],
  [0, 0, 0, 0, 0, 0],
  [0, 0, 5, 5, 5, 5, 0, 0],
  [0, 0, 10, 0, 20, 0, 30, 0],
  [0, 0, 10, 0, 5, 5, 10, 0, 0, 0],
  [Number.NaN, 0, 1, 1, 2, 2],
  [0, 0, 1, Number.POSITIVE_INFINITY, 2, 0],
  [0, 0, 1, 1, 2, 2, 3],
  [-0, -0, 1, -1, 2, -0, 3, 1],
];
const TOLERANCES: (number | undefined)[] = [undefined, 0, -0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.35, 5, 1e308, 1e-300];

test("simplify: RDP indices and points match on edge paths", () => {
  for (const path of SIMPLIFY_PATHS) {
    for (const tol of TOLERANCES) {
      agree(`simplifyPathIndices [${path}] ${tol}`, () => ts.simplifyPathIndices(path, tol), () => rs.simplifyPathIndices(path, tol));
      agree(`simplifyInkPath [${path}] ${tol}`, () => ts.simplifyInkPath(path, tol), () => rs.simplifyInkPath(path, tol));
    }
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const s = stroke(rand);
    const tol = pick(rand, TOLERANCES);
    agree(`seed ${seed} simplifyPathIndices`, () => ts.simplifyPathIndices(s.points, tol), () => rs.simplifyPathIndices(s.points, tol));
    agree(`seed ${seed} simplifyInkPath`, () => ts.simplifyInkPath(s.points, tol), () => rs.simplifyInkPath(s.points, tol));
  }
});

const QUANTIZE_VALUES: number[] = [
  ...NUMS,
  0.005,
  -0.005,
  1.005,
  12.345,
  -12.345,
];

test("quantize: rounding and non-finite rejection match", () => {
  const decimals: (number | undefined)[] = [undefined, 0, 1, 2, 3, 5];
  for (const d of decimals) {
    agree(`quantizeInkPath all ${d}`, () => ts.quantizeInkPath(QUANTIZE_VALUES, d), () => rs.quantizeInkPath(QUANTIZE_VALUES, d));
    for (const v of QUANTIZE_VALUES) {
      agree(`quantizeInkPath [${v}] ${d}`, () => ts.quantizeInkPath([v], d), () => rs.quantizeInkPath([v], d));
    }
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const s = stroke(rand);
    const d = pick(rand, decimals);
    agree(`seed ${seed} quantizeInkPath`, () => ts.quantizeInkPath(s.points, d), () => rs.quantizeInkPath(s.points, d));
  }
});

// Long enough that the maxPoints budget bites. Kept at 200 points or fewer.
const LONG_ZIGZAG: number[] = Array.from({ length: 400 }, (_, i) => (i % 2 === 0 ? i * 0.7 : Math.sin(i) * 3));

const COMPACT_PATHS: number[][] = [
  [],
  [1, 2],
  [1, 2, 3, 4],
  [1, 2, 3],
  [Number.NaN, 0, 1, 1],
  [0, 0, Number.POSITIVE_INFINITY, 0, 1, 1],
  [-0, -0, 1, 1],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0],
  [0.125, -0.125, 2.5, -2.5, 12.345, -12.345],
  LONG_ZIGZAG,
];

// Options are passed as-is. Fields are omitted rather than set to undefined to keep
// the object shape the wrapper's type declares.
// maxPoints 0 and negative are skipped: the TS path writes off-array properties
// (`out[-2]`) on an empty result, which is not a stored stroke shape.
const COMPACT_OPTIONS: ({ tolerance?: number; maxPoints?: number; decimals?: number } | undefined)[] = [
  undefined,
  {},
  { tolerance: 0 },
  { tolerance: -1 },
  { tolerance: 0.35 },
  { tolerance: 2 },
  { maxPoints: 1 },
  { maxPoints: 2 },
  { maxPoints: 3 },
  { maxPoints: 7 },
  { maxPoints: 400 },
  { decimals: 0 },
  { decimals: 1 },
  { decimals: 3 },
  { tolerance: 0.5, maxPoints: 20, decimals: 1 },
  { tolerance: 0.1, maxPoints: 5, decimals: 4 },
];

test("compact: options absent, partial and full, incl. small maxPoints", () => {
  for (const path of COMPACT_PATHS) {
    for (const opts of COMPACT_OPTIONS) {
      agree(
        `compactInkPath [${path.length}] ${JSON.stringify(opts)}`,
        () => ts.compactInkPath(path, opts),
        () => rs.compactInkPath(path, opts),
      );
    }
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const s = stroke(rand, 200);
    const opts = pick(rand, COMPACT_OPTIONS);
    agree(`seed ${seed} compactInkPath`, () => ts.compactInkPath(s.points, opts), () => rs.compactInkPath(s.points, opts));
  }
});

const JSON_SIZE_PATHS: number[][] = [
  [],
  [0],
  [-0],
  [Number.NaN],
  [Number.POSITIVE_INFINITY],
  [1e21],
  [1e-7],
  [0.1 + 0.2],
  [1e308, -1e308],
  [1, 2, 3, 4],
];

test("json size: matches JSON.stringify length on edge paths", () => {
  for (const path of JSON_SIZE_PATHS) {
    agree(`inkPathJsonSize [${path}]`, () => ts.inkPathJsonSize(path), () => rs.inkPathJsonSize(path));
  }
  for (const seed of SEEDS) {
    const s = stroke(random(seed));
    agree(`seed ${seed} inkPathJsonSize`, () => ts.inkPathJsonSize(s.points), () => rs.inkPathJsonSize(s.points));
  }
});

test("group join: null, field-by-field and window edges match", () => {
  const base: InkGroupCandidate = { pageIndex: 1, color: "#ff0000", width: 2, pathCount: 1, lastAt: 1000 };
  const groups: (InkGroupCandidate | null)[] = [
    null,
    base,
    { ...base, pathCount: 0 },
    { ...base, pathCount: 63 },
    { ...base, pathCount: 64 },
    { ...base, pathCount: 65 },
    { ...base, pageIndex: 2 },
    { ...base, color: " #ff0000" },
    { ...base, color: "" },
    { ...base, width: 0 },
    { ...base, width: -0 },
    { ...base, width: Number.NaN },
    { ...base, lastAt: Number.NaN },
    { ...base, lastAt: 1e308 },
  ];
  const nexts = [
    { pageIndex: 1, color: "#ff0000", width: 2, at: 1000 },
    { pageIndex: 1, color: "#ff0000", width: 2, at: 999 },
    { pageIndex: 1, color: "#ff0000", width: 2, at: 2999 },
    { pageIndex: 1, color: "#ff0000", width: 2, at: 3000 },
    { pageIndex: 1, color: "#ff0000", width: 2, at: 3001 },
    { pageIndex: 1, color: "#ff0000", width: 2, at: Number.NaN },
    { pageIndex: 1, color: "#ff0000", width: 2, at: Number.POSITIVE_INFINITY },
    { pageIndex: 1, color: "#ff0000", width: 2, at: Number.NEGATIVE_INFINITY },
    { pageIndex: 1, color: "#ff0000", width: 0, at: 1000 },
    { pageIndex: 3, color: "#ff0000", width: 2, at: 1000 },
    { pageIndex: 1, color: "#00ff00", width: 2, at: 1000 },
    { pageIndex: 1, color: "é", width: 2, at: 1000 },
  ];
  const windows: (number | undefined)[] = [undefined, 0, 2000, 1e308, Number.POSITIVE_INFINITY, Number.NaN, -1];
  for (const g of groups) {
    for (const n of nexts) {
      for (const w of windows) {
        agree(
          `canJoinInkGroup ${JSON.stringify(g)} ${JSON.stringify(n)} ${w}`,
          () => ts.canJoinInkGroup(g, n, w),
          () => rs.canJoinInkGroup(g, n, w),
        );
      }
    }
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const lastAt = rand() * 5000;
    const g: InkGroupCandidate = {
      pageIndex: Math.floor(rand() * 3),
      color: pick(rand, STRINGS.slice(0, 3)),
      width: pick(rand, [2, 0, -0, Number.NaN]),
      pathCount: Math.floor(rand() * 70),
      lastAt,
    };
    const n = {
      pageIndex: Math.floor(rand() * 3),
      color: pick(rand, STRINGS.slice(0, 3)),
      width: pick(rand, [2, 0, -0, Number.NaN]),
      at: lastAt + (rand() - 0.3) * 4000,
    };
    const w = pick(rand, windows);
    agree(`seed ${seed} canJoinInkGroup`, () => ts.canJoinInkGroup(g, n, w), () => rs.canJoinInkGroup(g, n, w));
  }
});

test("join: string colours compare by code unit, not by look", () => {
  for (const a of STRINGS) {
    for (const b of STRINGS) {
      const g: InkGroupCandidate = { pageIndex: 0, color: a, width: 2, pathCount: 0, lastAt: 0 };
      const n = { pageIndex: 0, color: b, width: 2, at: 0 };
      agree(`canJoinInkGroup colour ${JSON.stringify(a)} ${JSON.stringify(b)}`, () => ts.canJoinInkGroup(g, n), () => rs.canJoinInkGroup(g, n));
    }
  }
});

// Hit-test and translate inputs: nested paths with odd lengths, NaN and -0 coordinates.
const NESTED_PATHS: number[][][] = [
  [],
  [[]],
  [[], [1, 2]],
  [[1]],
  [[0, 0]],
  [[0, 0, 10, 0]],
  [[0, 0, 10, 0], [20, 20, 20, 30]],
  [[0, 0, 5, 5, 10, 0, 1]],
  [[Number.NaN, 0, 1, 1]],
  [[-0, -0]],
];

test("hit test: segment distance and radius edges match", () => {
  const xs: number[] = [0, -0, 5, 10, Number.NaN, Number.POSITIVE_INFINITY, -1, 20, 25];
  const radii: number[] = [-1, -0, 0, 0.5, 1, 5, Number.NaN, Number.POSITIVE_INFINITY];
  for (const paths of NESTED_PATHS) {
    for (const x of xs) {
      for (const y of xs) {
        for (const r of radii) {
          agree(
            `inkPathsHitTest [${paths.length}] ${x} ${y} ${r}`,
            () => ts.inkPathsHitTest(paths, x, y, r),
            () => rs.inkPathsHitTest(paths, x, y, r),
          );
        }
      }
    }
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const paths = [stroke(rand).points, stroke(rand).points];
    const anchor = paths[0]!;
    const i = Math.floor(rand() * Math.max(1, anchor.length / 2)) * 2;
    const x = (anchor[i] ?? 0) + rand() * 4 - 2;
    const y = (anchor[i + 1] ?? 0) + rand() * 4 - 2;
    const r = rand() * 50;
    agree(`seed ${seed} inkPathsHitTest`, () => ts.inkPathsHitTest(paths, x, y, r), () => rs.inkPathsHitTest(paths, x, y, r));
  }
});

test("translate: offsets, decimals and ties match", () => {
  const offsets: number[] = [0, -0, 1, -2.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e308];
  const decimals: (number | undefined)[] = [undefined, 0, 1, 2, 4];
  const paths: number[][][] = [...NESTED_PATHS, [[0.125, -0.125, 2.5, -2.5]], [[1.005, 12.345]]];
  for (const set of paths) {
    for (const dx of offsets) {
      for (const dy of offsets) {
        for (const d of decimals) {
          agree(
            `translateInkPaths [${set.length}] ${dx} ${dy} ${d}`,
            () => ts.translateInkPaths(set, dx, dy, d),
            () => rs.translateInkPaths(set, dx, dy, d),
          );
        }
      }
    }
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const set = [stroke(rand).points, stroke(rand).points];
    const dx = rand() * 200 - 100;
    const dy = rand() * 200 - 100;
    const d = pick(rand, decimals);
    agree(`seed ${seed} translateInkPaths`, () => ts.translateInkPaths(set, dx, dy, d), () => rs.translateInkPaths(set, dx, dy, d));
  }
});

test("bounds: empty, non-finite and seeded paths match", () => {
  const cases: number[][][] = [
    [],
    [[]],
    [[], []],
    [[Number.NaN, 1]],
    [[1, 2]],
    [[1, 2], [3, 4]],
    [[-0, 5]],
    [[Number.POSITIVE_INFINITY, 0, 1, 2]],
    [[0, 0, 5, 5, 1]],
    ...NESTED_PATHS,
  ];
  for (const set of cases) {
    agree(`inkPathsBounds [${set.length}]`, () => ts.inkPathsBounds(set), () => rs.inkPathsBounds(set));
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const set = [stroke(rand).points, stroke(rand).points];
    agree(`seed ${seed} inkPathsBounds`, () => ts.inkPathsBounds(set), () => rs.inkPathsBounds(set));
  }
});
