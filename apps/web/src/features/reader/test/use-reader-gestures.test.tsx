/**
 * The gesture recogniser: what it decides, and what it refuses to decide.
 *
 * These are the rules a hand feels when they are wrong, so they are pinned one
 * by one: the tolerance before anything moves, the single intent a gesture locks
 * to, the dominance that separates two fingers spreading from two fingers
 * walking, the deadband that stops a pinch shimmering, and the fact that a
 * stylus is not part of any of it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { useReaderGestures, type ReaderGestures } from "../ui/use-reader-gestures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Frames, under the test's own hand: the preview is published once per frame,
 * so this queue is what a frame boundary is here.
 */
const frames: FrameRequestCallback[] = [];
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
  callback: FrameRequestCallback,
) => {
  frames.push(callback);
  return frames.length;
};
(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {};
function frame() {
  const due = frames.splice(0, frames.length);
  act(() => {
    for (const callback of due) callback(0);
  });
}

interface Scroller {
  scrollBy: (dx: number, dy: number) => void;
  moves: [number, number][];
  rect: { left: number; top: number };
  getBoundingClientRect: () => DOMRect;
}

function mount({ rect = { left: 0, top: 0 } } = {}) {
  const previews: { factor: number; x: number; y: number }[] = [];
  const commits: { factor: number; x: number; y: number }[] = [];
  let cancelled = 0;
  const scroller = {
    moves: [] as [number, number][],
    rect,
    scrollBy(dx: number, dy: number) {
      scroller.moves.push([dx, dy]);
    },
    getBoundingClientRect() {
      return { ...rect, right: 1000, bottom: 800, width: 1000, height: 800 } as DOMRect;
    },
  };

  let api!: ReaderGestures;
  function Host() {
    api = useReaderGestures({
      scrollRef: { current: scroller as unknown as HTMLElement },
      onGestureStart: () => {
        cancelled += 1;
      },
      onZoomPreview: (factor, x, y) => previews.push({ factor, x, y }),
      onZoomCommit: (factor, x, y) => commits.push({ factor, x, y }),
    });
    return createElement("i");
  }
  act(() => {
    create(createElement(Host));
  });
  return { api: () => api, previews, commits, moves: scroller.moves, cancelled: () => cancelled };
}

function touch(pointerId: number, x: number, y: number, pointerType = "touch") {
  return {
    pointerId,
    pointerType,
    clientX: x,
    clientY: y,
    preventDefault() {},
  } as unknown as React.PointerEvent;
}

test("one finger pans, and never draws", () => {
  const h = mount();
  assert.equal(h.api().begin(touch(1, 100, 100)), true, "the page's, not the tool's");
  assert.equal(h.api().move(touch(1, 130, 120)), true);
  // Nothing happens until the frame: one measurement, with the finger where it is.
  frame();
  assert.deepEqual(h.moves, [[-30, -20]]);
  assert.equal(h.api().end(touch(1, 130, 120)), true);
  assert.equal(h.commits.length, 0);
});

test("a tolerance: a tremble moves nothing at all", () => {
  const h = mount();
  h.api().begin(touch(1, 200, 200));
  h.api().begin(touch(2, 300, 200));
  // Both fingers jitter a few pixels: under the slop, so neither pan nor zoom.
  h.api().move(touch(1, 204, 203));
  h.api().move(touch(2, 296, 202));
  frame();
  assert.equal(h.moves.length, 0, "no pan");
  assert.equal(h.previews.length, 0, "no zoom");
  assert.equal(h.cancelled(), 1, "the first finger's stroke was dropped, though");
});

test("two fingers spreading is a zoom, previewed and committed once", () => {
  const h = mount();
  h.api().begin(touch(1, 300, 300));
  h.api().begin(touch(2, 400, 300));
  // 100 apart, then 200: a factor of two.
  h.api().move(touch(2, 500, 300));
  frame();
  assert.deepEqual(h.previews.map((p) => Math.round(p.factor)), [2]);
  assert.equal(h.commits.length, 0, "nothing is committed while the fingers are down");
  assert.equal(h.moves.length, 0, "a pinch does not scroll");
  h.api().end(touch(2, 500, 300));
  h.api().end(touch(1, 300, 300));
  // `deepEqual` narrows its first argument to the type of the second, and a
  // narrowed array is a `never[]` for the rest of the test — so the empty cases
  // are written as lengths.
  assert.deepEqual(h.commits.map((c) => Math.round(c.factor)), [2]);
});

test("two fingers walking are a pan, however far they go", () => {
  // The clash this exists to stop: a pair that keeps its span while travelling
  // must scroll, and must not touch the scale on the way.
  const h = mount();
  h.api().begin(touch(1, 200, 300));
  h.api().begin(touch(2, 300, 300));
  for (let i = 1; i <= 6; i += 1) {
    h.api().move(touch(1, 200 + i * 20, 300 + i * 15));
    h.api().move(touch(2, 300 + i * 20, 300 + i * 15));
    frame();
  }
  assert.equal(h.previews.length, 0, "no zoom at all");
  assert.equal(h.commits.length, 0);
  const travelled = h.moves.reduce((sum, [dx]) => sum + dx, 0);
  // The first 20px of the walk was the tolerance that decided this was a pan and
  // not a pinch; the five frames after it were the page following the pair.
  assert.equal(Math.round(travelled), -100, "and the page followed the pair");
});

test("the intent locks: a walk after a pinch keeps zooming", () => {
  const h = mount();
  h.api().begin(touch(1, 300, 300));
  h.api().begin(touch(2, 400, 300));
  h.api().move(touch(2, 500, 300));
  frame();
  assert.equal(h.previews.length, 1, "now zooming");
  // The fingers then walk with their span held: a hook that re-guessed every
  // frame would pan here. This one stays a pinch, because a gesture is one thing
  // until it ends.
  h.api().move(touch(1, 320, 320));
  h.api().move(touch(2, 520, 320));
  frame();
  assert.equal(h.moves.length, 0, "no scroll crept in");
  assert.equal(h.previews.length, 2, "still zooming");
});

test("the intent locks: a spread after a walk keeps panning", () => {
  const h = mount();
  h.api().begin(touch(1, 200, 300));
  h.api().begin(touch(2, 300, 300));
  // The first 40px of the walk is the tolerance: it decides the intent and is
  // absorbed, the way a slop is on every platform.
  h.api().move(touch(1, 240, 300));
  h.api().move(touch(2, 340, 300));
  frame();
  assert.equal(h.moves.length, 0, "the slop distance is absorbed");
  // From there the pair is panning.
  h.api().move(touch(1, 260, 300));
  h.api().move(touch(2, 360, 300));
  frame();
  assert.ok(h.moves.length > 0, "panning now");
  // And a spread mid-drag must not turn it into a zoom: the intent was locked
  // on the first movement that crossed the tolerance.
  h.api().move(touch(1, 220, 300));
  h.api().move(touch(2, 420, 300));
  frame();
  assert.equal(h.previews.length, 0, "still a pan, whatever the span does");
});

test("a pinch inside the deadband holds the scale exactly", () => {
  const h = mount();
  // A wide pair, so a span change big enough to be a pinch (>16px) can still be
  // inside the deadband (3% of 600px is 18px).
  h.api().begin(touch(1, 200, 300));
  h.api().begin(touch(2, 800, 300));
  h.api().move(touch(2, 817, 300));
  frame();
  assert.deepEqual(
    h.previews.map((p) => p.factor),
    [1],
    "no shimmer from a three-percent wobble",
  );
});

test("a pinch that loses a finger commits, and the finger left pans", () => {
  const h = mount();
  h.api().begin(touch(1, 300, 300));
  h.api().begin(touch(2, 400, 300));
  h.api().move(touch(2, 500, 300));
  frame();
  assert.equal(h.api().end(touch(2, 500, 300)), true);
  assert.deepEqual(h.commits.map((c) => Math.round(c.factor)), [2], "committed on the lift");
  assert.equal(h.api().move(touch(1, 300, 340)), true);
  frame();
  assert.deepEqual(
    h.moves.map(([dx, dy]) => [dx || 0, dy || 0]),
    [[0, -40]],
    "and the remaining finger scrolls",
  );
});

test("a stylus is not a finger: a pen draws through all of it", () => {
  const h = mount();
  h.api().begin(touch(1, 300, 300));
  h.api().begin(touch(2, 400, 300));
  assert.equal(h.api().begin(touch(3, 350, 350, "pen")), false);
  assert.equal(h.api().move(touch(3, 360, 360, "pen")), false);
  assert.equal(h.api().end(touch(3, 360, 360, "pen")), false);
});

test("the focus is reported in the scroller's own coordinates", () => {
  const h = mount({ rect: { left: 40, top: 60 } });
  h.api().begin(touch(1, 300, 400));
  h.api().begin(touch(2, 400, 400));
  h.api().move(touch(2, 500, 400));
  frame();
  assert.deepEqual(
    // The midpoint the pinch *started* on — 350 — with the scroller at x 40, y 60.
    h.previews.map((p) => [Math.round(p.x), Math.round(p.y)]),
    [[310, 340]],
  );
});

test("a pinch zooms where it started, and does not pan while it zooms", () => {
  // The drift that was reported: a midpoint wanders as two fingers spread, and a
  // focus that followed it slid the page sideways while it scaled.
  const h = mount();
  h.api().begin(touch(1, 300, 400));
  h.api().begin(touch(2, 400, 400));
  h.api().move(touch(2, 500, 400));
  frame();
  const first = h.previews[0];
  assert.ok(first);
  // Now the pair walks, keeping the span it had grown to: still a zoom, and the
  // focus has not moved with it.
  h.api().move(touch(1, 380, 460));
  h.api().move(touch(2, 580, 460));
  frame();
  assert.equal(h.previews.length, 2, "still zooming");
  assert.deepEqual(
    [Math.round(h.previews[1]!.x), Math.round(h.previews[1]!.y)],
    [Math.round(first.x), Math.round(first.y)],
    "the focus is where the pinch began",
  );
  assert.equal(h.moves.length, 0, "and the paper did not pan");
});
