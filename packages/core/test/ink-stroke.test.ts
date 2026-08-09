import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canJoinInkGroup,
  clampInkWidth,
  compactInkPath,
  HIGHLIGHTER_MIN_WIDTH,
  INK_DEFAULT_WIDTH,
  INK_MAX_POINTS,
  inkPathJsonSize,
  inkPathsBounds,
  inkPathsHitTest,
  inkWidthForPressure,
  isHighlighterInk,
  meanPressure,
  quantizeInkPath,
  shouldAppendInkPoint,
  simplifyInkPath,
  translateInkPaths,
} from "../src/reader/ink-stroke.js";

/** A hand-drawn-ish stroke: a sine wave sampled far denser than its shape needs. */
function denseStroke(samples: number, amplitude = 6): number[] {
  const path: number[] = [];
  for (let i = 0; i < samples; i++) {
    const x = (i / samples) * 300;
    path.push(x, 400 + Math.sin(i / 9) * amplitude);
  }
  return path;
}

test("shouldAppendInkPoint drops samples inside the pen's own jitter", () => {
  assert.equal(shouldAppendInkPoint([], 10, 10), true, "the first point always counts");
  assert.equal(shouldAppendInkPoint([10, 10], 10.1, 10.1), false);
  assert.equal(shouldAppendInkPoint([10, 10], 12, 10), true);
});

test("simplifyInkPath keeps the endpoints and the shape", () => {
  const path = denseStroke(600);
  const simplified = simplifyInkPath(path);

  assert.equal(simplified[0], path[0]);
  assert.equal(simplified[1], path[1]);
  assert.equal(simplified[simplified.length - 2], path[path.length - 2]);
  assert.equal(simplified[simplified.length - 1], path[path.length - 1]);
  assert.ok(
    simplified.length < path.length / 3,
    `expected a large reduction, got ${simplified.length} of ${path.length}`,
  );
});

test("simplifyInkPath collapses a straight line to its two ends", () => {
  const straight: number[] = [];
  for (let i = 0; i <= 50; i++) straight.push(i * 2, 100);
  assert.deepEqual(simplifyInkPath(straight), [0, 100, 100, 100]);
});

test("simplifyInkPath handles a stroke long enough to blow a recursive stack", () => {
  const huge: number[] = [];
  for (let i = 0; i < 60_000; i++) huge.push(i * 0.01, 100 + (i % 2) * 0.9);
  const simplified = simplifyInkPath(huge, 0.001);
  assert.ok(simplified.length > 0);
});

test("quantizeInkPath rounds away device float noise", () => {
  assert.deepEqual(quantizeInkPath([1.234567, 8.7654321]), [1.23, 8.77]);
  assert.deepEqual(quantizeInkPath([1, Number.NaN]), [], "a broken sample voids the path");
});

test("compactInkPath cuts a captured stroke to a fraction of its stored size", () => {
  const raw = denseStroke(800);
  const compact = compactInkPath(raw);

  assert.ok(compact.length >= 4);
  assert.ok(
    inkPathJsonSize(compact) < inkPathJsonSize(raw) / 10,
    `stored size barely moved: ${inkPathJsonSize(compact)} vs ${inkPathJsonSize(raw)}`,
  );
});

test("compactInkPath caps even a pathological scribble", () => {
  // Every sample deviates, so simplification alone cannot get under the cap.
  const scribble: number[] = [];
  for (let i = 0; i < 20_000; i++) scribble.push(i * 0.5, 300 + (i % 2 === 0 ? 40 : -40));

  const compact = compactInkPath(scribble);

  assert.ok(
    compact.length / 2 <= INK_MAX_POINTS,
    `cap breached: ${compact.length / 2} points`,
  );
  assert.equal(compact[compact.length - 2], scribble[scribble.length - 2], "the end is kept");
  assert.equal(compact[compact.length - 1], scribble[scribble.length - 1]);
});

test("compactInkPath refuses anything that is not a stroke", () => {
  assert.deepEqual(compactInkPath([]), []);
  assert.deepEqual(compactInkPath([1, 2]), []);
  assert.deepEqual(compactInkPath([1, 2, Number.POSITIVE_INFINITY, 4]), []);
});

test("inkWidthForPressure separates a pen from a mouse", () => {
  assert.equal(inkWidthForPressure(undefined), INK_DEFAULT_WIDTH);
  assert.equal(inkWidthForPressure(0), INK_DEFAULT_WIDTH, "0 means the device is silent");
  assert.equal(inkWidthForPressure(0.5), INK_DEFAULT_WIDTH, "0.5 is the mouse default");

  const light = inkWidthForPressure(0.1);
  const heavy = inkWidthForPressure(1);
  assert.ok(light < INK_DEFAULT_WIDTH, `light press should thin the stroke, got ${light}`);
  assert.ok(heavy > INK_DEFAULT_WIDTH, `full press should thicken it, got ${heavy}`);
});

test("clampInkWidth keeps a stroke drawable", () => {
  assert.equal(clampInkWidth(Number.NaN), INK_DEFAULT_WIDTH);
  assert.equal(clampInkWidth(0), 0.75);
  assert.equal(clampInkWidth(1_000), 24);
});

test("meanPressure ignores samples from devices that report nothing", () => {
  assert.equal(meanPressure([0, 0, 0]), undefined);
  assert.equal(meanPressure([0.4, 0.6]), 0.5);
});

test("isHighlighterInk keys off the stored width", () => {
  assert.equal(isHighlighterInk(undefined), false);
  assert.equal(isHighlighterInk(2), false);
  assert.equal(isHighlighterInk(HIGHLIGHTER_MIN_WIDTH), true);
});

test("canJoinInkGroup merges strokes of one mark and splits everything else", () => {
  const group = { pageIndex: 3, color: "#ffd400", width: 2, pathCount: 2, lastAt: 1_000 };
  const next = { pageIndex: 3, color: "#ffd400", width: 2, at: 1_500 };

  assert.equal(canJoinInkGroup(group, next), true);
  assert.equal(canJoinInkGroup(null, next), false);
  assert.equal(canJoinInkGroup(group, { ...next, at: 9_000 }), false, "idle gap splits");
  assert.equal(canJoinInkGroup(group, { ...next, pageIndex: 4 }), false);
  assert.equal(canJoinInkGroup(group, { ...next, color: "#ff6666" }), false);
  assert.equal(canJoinInkGroup(group, { ...next, width: 14 }), false, "a different nib is a different mark");
  assert.equal(
    canJoinInkGroup({ ...group, pathCount: 64 }, next),
    false,
    "a full annotation must not grow without bound",
  );
});

test("inkPathsHitTest matches the stroke, not its bounding box", () => {
  // An L: down the left edge, then along the bottom. The top-right corner is
  // inside the bounding box but nowhere near any ink.
  const paths = [[0, 100, 0, 0, 100, 0]];
  assert.equal(inkPathsHitTest(paths, 0, 50, 3), true);
  assert.equal(inkPathsHitTest(paths, 50, 0, 3), true);
  assert.equal(inkPathsHitTest(paths, 100, 100, 3), false, "empty corner must not erase");
  assert.equal(inkPathsHitTest(paths, 2, 50, 3), true, "the radius is honoured");
});

test("translateInkPaths moves every stroke and keeps stored precision", () => {
  assert.deepEqual(translateInkPaths([[0, 0, 10, 10]], 1.006, -2), [[1.01, -2, 11.01, 8]]);
});

test("inkPathsBounds spans every stroke", () => {
  assert.deepEqual(inkPathsBounds([[0, 0, 5, 5], [-3, 2, 1, 9]]), [-3, 0, 5, 9]);
  assert.equal(inkPathsBounds([]), null);
});
