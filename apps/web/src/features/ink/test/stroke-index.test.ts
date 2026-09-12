/**
 * The stroke index: the two assertions §6.2.4 makes, and why each one is a bug
 * report waiting to happen.
 *
 * The page is the plan's dense one — 5 000 strokes, which is the soft cap — laid
 * out the way the harness laid it out, because a "dense page" whose strokes are all
 * in one corner would let a broken index pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { INK_A4_HEIGHT, INK_A4_WIDTH, makeInkStroke, type InkPage } from "@weaveforge/core";

import { InkPageBuffer } from "../application/page-buffer";
import { ERASER_RADIUS, InkStrokeIndex, MAX_PICK_CANDIDATES } from "../application/stroke-index";

/** The plan's dense page: 5 000 short strokes over 125 rows. */
function densePage(count = 5_000): InkPage {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const rows = Math.ceil(count / 40);
  const strokes = [];
  for (let s = 0; s < count; s += 1) {
    const y = ((s % rows) + 0.5) / rows * INK_A4_HEIGHT * 0.9 + INK_A4_HEIGHT * 0.05;
    const x = Math.floor(rnd() * INK_A4_WIDTH);
    const points = [x, Math.round(y)];
    const pressures = [128];
    for (let i = 1; i < 8; i += 1) {
      points.push(x + i * 6, Math.round(y + Math.sin(i) * 4));
      pressures.push(128);
    }
    strokes.push(makeInkStroke({ points, pressures, width: 6, t0: s * 120 }));
  }
  return {
    width: INK_A4_WIDTH,
    height: INK_A4_HEIGHT,
    paper: "blank",
    background: 0,
    strokes,
    lines: [],
  };
}

test("a pick on a dense page returns a handful of candidates, not hundreds", () => {
  const buffer = new InkPageBuffer(densePage());
  const index = new InkStrokeIndex(buffer);
  index.rebuild();
  assert.equal(index.size, 5_000);

  // Sample the page the way an eraser would: 200 positions along a swept diagonal.
  let worst = 0;
  let total = 0;
  for (let i = 0; i < 200; i += 1) {
    const x = (i / 200) * INK_A4_WIDTH;
    const y = (i / 200) * INK_A4_HEIGHT;
    const found = index.nearPoint(x, y);
    worst = Math.max(worst, found.length);
    total += found.length;
  }
  assert.ok(
    worst <= MAX_PICK_CANDIDATES,
    `the worst pick returned ${worst} candidates; §6.2.4 asks for ≤ ${MAX_PICK_CANDIDATES}`,
  );
  assert.ok(total > 0, "and it does find strokes, or the budget would be trivially met");
  // A grid left 785 strokes per occupied cell (§11.3.7), so anything in the
  // hundreds would mean the structure is not indexing.
  assert.ok(worst < 100, `a grid-like result would be hundreds; got ${worst}`);
});

test("candidates are real candidates: the box filter is what the tree stored", () => {
  const buffer = new InkPageBuffer(densePage(400));
  const index = new InkStrokeIndex(buffer);
  index.rebuild();
  const stroke = buffer.stroke(10)!;
  const centreX = (stroke.bounds[0] + stroke.bounds[2]) / 2;
  const centreY = (stroke.bounds[1] + stroke.bounds[3]) / 2;
  const found = index.nearPoint(centreX, centreY, 1);
  assert.ok(found.includes(10), "a point inside a stroke finds that stroke");
  for (const candidate of found) {
    const bounds = buffer.stroke(candidate)!.bounds;
    assert.ok(
      bounds[0] - 1 <= centreX && bounds[2] + 1 >= centreX && bounds[1] - 1 <= centreY && bounds[3] + 1 >= centreY,
      "and everything it returns does meet the query box",
    );
  }
});

test("a swept eraser across a dense page rebuilds the index zero times", () => {
  // The assertion §6.2.4 makes: a 200-event sweep must not rebuild a packed R-tree
  // per removal, which re-sorts every box and allocates two typed arrays a time.
  const buffer = new InkPageBuffer(densePage());
  const index = new InkStrokeIndex(buffer);
  index.rebuild();
  const buildsAfterLoad = index.rebuilds;

  let erased = 0;
  for (let i = 0; i < 200; i += 1) {
    const x = (i / 200) * INK_A4_WIDTH;
    const y = (i / 200) * INK_A4_HEIGHT;
    for (const candidate of index.nearSegment(x, y, x + 20, y + 20)) {
      // The eraser hit-tests the path before erasing; here the bounds are enough
      // to prove the index is not being touched.
      if (buffer.erase(candidate)) erased += 1;
    }
  }
  assert.ok(erased > 0, "the sweep removed something, or the test proves nothing");
  assert.equal(index.rebuilds, buildsAfterLoad, "not one rebuild during the gesture");

  // And the erased strokes are invisible to the very next query, without a rebuild.
  const firstErased = buffer.liveStrokes().length;
  assert.equal(buffer.liveCount, 5_000 - erased);
  assert.ok(firstErased < 5_000);

  // The rebuild is one deliberate pass at pointerup.
  index.rebuild();
  assert.equal(index.rebuilds, buildsAfterLoad + 1);
  assert.equal(index.size, 5_000 - erased, "and it no longer indexes the dead");
});

test("containment finds a stroke by a point inside its own box", () => {
  const buffer = new InkPageBuffer(densePage(200));
  const index = new InkStrokeIndex(buffer);
  index.rebuild();
  const stroke = buffer.stroke(3)!;
  const found = index.containing(stroke.x[0]!, stroke.y[0]!);
  assert.ok(found.includes(3), "the stroke whose own corner this is comes back");
  // Not `[3]`: a dense page's boxes overlap, and the index's job is to return the
  // candidates a hit-test then narrows. What it may never do is return one whose
  // box does not actually contain the point.
  for (const candidate of found) {
    const bounds = buffer.stroke(candidate)!.bounds;
    assert.ok(
      stroke.x[0]! >= bounds[0] && stroke.x[0]! <= bounds[2] && stroke.y[0]! >= bounds[1] && stroke.y[0]! <= bounds[3],
      `candidate ${candidate} does not contain the point`,
    );
  }
  assert.deepEqual(index.containing(-100, -100), [], "and nothing for a point off the page");
});

test("a stroke removed from the buffer is skipped by the next query", () => {
  const buffer = new InkPageBuffer(densePage(200));
  const index = new InkStrokeIndex(buffer);
  index.rebuild();
  const stroke = buffer.stroke(7)!;
  const x = stroke.x[0]!;
  const y = stroke.y[0]!;
  assert.ok(index.containing(x, y).includes(7));
  buffer.erase(7);
  assert.ok(!index.containing(x, y).includes(7), "the tombstone is visible without a rebuild");
});

test("an index over an empty page answers nothing", () => {
  const buffer = new InkPageBuffer({
    width: INK_A4_WIDTH,
    height: INK_A4_HEIGHT,
    paper: "blank",
    background: 0,
    strokes: [],
    lines: [],
  });
  const index = new InkStrokeIndex(buffer);
  index.rebuild();
  assert.equal(index.size, 0);
  assert.deepEqual(index.nearPoint(100, 100, ERASER_RADIUS), []);
  assert.deepEqual(index.nearBox([0, 0, 100, 100]), []);
});
