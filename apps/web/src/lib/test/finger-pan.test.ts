import { test } from "node:test";
import assert from "node:assert/strict";

import { FingerPan } from "../finger-pan";

/** A clock and a frame queue the test steps by hand. */
function harness() {
  let now = 0;
  const frames: ((time: number) => void)[] = [];
  const scrolled: [number, number][] = [];
  const pan = new FingerPan((dx, dy) => scrolled.push([dx, dy]), {
    now: () => now,
    request: (run) => frames.push(run) - 1,
    cancel: (id) => {
      frames[id] = () => undefined;
    },
  });
  const tick = (ms: number) => {
    now += ms;
    const pending = frames.splice(0);
    for (const run of pending) run(now);
  };
  const total = () => scrolled.reduce((sum, [, dy]) => sum + dy, 0);
  return { pan, scrolled, tick, total, at: (ms: number) => (now = ms), frames };
}

test("while the finger is down the page follows it, the other way", () => {
  const h = harness();
  h.pan.move(0, 10);
  assert.deepEqual(h.scrolled, [[-0, -10]]);
});

/** How far the page glides after a flick of `step` px per 16 ms frame. */
function glideAfter(step: number): number {
  const h = harness();
  for (let t = 0; t <= 64; t += 16) {
    h.at(t);
    h.pan.move(0, step);
  }
  const dragged = h.total();
  h.pan.release();
  for (let i = 0; i < 1000 && h.frames.length > 0; i += 1) h.tick(16);
  return Math.abs(h.total() - dragged);
}

test("a faster flick glides further", () => {
  const slow = glideAfter(-10);
  const fast = glideAfter(-40);
  assert.ok(slow > 0);
  assert.ok(fast > slow * 3, `fast ${fast} vs slow ${slow}`);
});

test("a normal pan at reading speed does not glide", () => {
  assert.equal(glideAfter(-3), 0);
});

test("a finger that paused 40 ms before lifting does not glide", () => {
  const h = harness();
  for (let t = 0; t <= 64; t += 16) {
    h.at(t);
    h.pan.move(0, -40);
  }
  h.at(64 + 45);
  h.pan.release();
  assert.equal(h.frames.length, 0);
});

test("a flick keeps the page gliding after the finger lifts, then it stops", () => {
  const h = harness();
  for (let t = 0; t <= 64; t += 16) {
    h.at(t);
    h.pan.move(0, -20);
  }
  const dragged = h.total();
  h.pan.release();
  for (let i = 0; i < 400 && h.frames.length > 0; i += 1) h.tick(16);
  assert.ok(dragged > 0 && h.total() > dragged + 100, "glided on, same direction");
  assert.equal(h.frames.length, 0, "glide ends on its own");
});

test("a finger that stopped before lifting does not glide", () => {
  const h = harness();
  h.pan.move(0, -20);
  h.at(200);
  h.pan.release();
  assert.equal(h.frames.length, 0);
});

test("a finger landing stops the glide", () => {
  const h = harness();
  for (let t = 0; t <= 64; t += 16) {
    h.at(t);
    h.pan.move(0, -20);
  }
  h.pan.release();
  h.tick(16);
  const before = h.scrolled.length;
  h.pan.stop();
  h.tick(16);
  assert.equal(h.scrolled.length, before);
});
