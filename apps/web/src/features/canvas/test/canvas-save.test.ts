import { test } from "node:test";
import assert from "node:assert/strict";

import { CanvasSaver } from "../application/canvas-save";

/** A timer that only fires when the test says so. */
function fakeTimers() {
  let next = 1;
  const armed = new Map<number, () => void>();
  return {
    schedule: (fn: () => void) => {
      const id = next++;
      armed.set(id, fn);
      return id;
    },
    unschedule: (handle: unknown) => {
      armed.delete(handle as number);
    },
    fire: () => {
      for (const [id, fn] of [...armed]) {
        armed.delete(id);
        fn();
      }
    },
    armedCount: () => armed.size,
  };
}

function setup(initial: string) {
  const timers = fakeTimers();
  const written: string[] = [];
  const errors: unknown[] = [];
  let text = initial;
  const saver = new CanvasSaver({
    write: (t) => void written.push(t),
    onError: (e) => void errors.push(e),
    schedule: timers.schedule,
    unschedule: timers.unschedule,
  });
  const read = () => text;
  return {
    saver,
    timers,
    written,
    errors,
    read,
    edit: (next: string) => (text = next),
  };
}

test("the first touch only records the loaded text, so opening never writes", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.timers.fire();
  s.saver.flush(s.read);
  assert.deepEqual(s.written, []);
  assert.equal(s.timers.armedCount(), 0);
});

test("a change saves once after the debounce, not on every touch", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.touch(s.read);
  s.edit("C");
  s.saver.touch(s.read);
  assert.equal(s.timers.armedCount(), 1, "each touch re-arms the one timer");
  assert.deepEqual(s.written, []);
  s.timers.fire();
  assert.deepEqual(s.written, ["C"]);
});

test("flush writes a pending change at once and never writes the same text twice", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.touch(s.read);
  s.saver.flush(s.read);
  s.saver.flush(s.read);
  s.timers.fire();
  assert.deepEqual(s.written, ["B"]);
  assert.equal(s.saver.hasPending(), false);
});

test("flush with nothing pending does nothing (closing an untouched canvas)", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.saver.flush(s.read);
  assert.deepEqual(s.written, []);
});

test("halting drops the pending save: an invalid body is never overwritten", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.touch(s.read);
  s.saver.halt();
  s.timers.fire();
  s.saver.flush(s.read);
  s.saver.touch(s.read);
  s.timers.fire();
  assert.deepEqual(s.written, [], "neither the timer nor flush may write while halted");
  assert.equal(s.saver.hasPending(), false);
});

test("resume after a halt saves again from the next change", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.saver.halt();
  s.saver.resume();
  s.edit("B");
  s.saver.touch(s.read);
  s.timers.fire();
  assert.deepEqual(s.written, ["B"]);
});

test("a write that fails is reported through onError", async () => {
  const timers = fakeTimers();
  const errors: unknown[] = [];
  const saver = new CanvasSaver({
    write: () => Promise.reject(new Error("disk full")),
    onError: (e) => void errors.push(e),
    schedule: timers.schedule,
    unschedule: timers.unschedule,
  });
  let text = "A";
  saver.touch(() => text);
  text = "B";
  saver.flush(() => text);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(errors.map((e) => (e as Error).message), ["disk full"]);
});

test("a read that throws is reported and nothing is written", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.flush(() => {
    throw new Error("bad canvas");
  });
  assert.deepEqual(s.written, []);
  assert.deepEqual(s.errors.map((e) => (e as Error).message), ["bad canvas"]);
});

test("a body that was just written is recognised as our own echo", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.touch(s.read);
  s.saver.flush(s.read);
  s.edit("C");
  s.saver.touch(s.read);
  s.saver.flush(s.read);
  assert.equal(s.saver.isOwnEcho("B"), true, "an earlier save echoing back is ours");
  assert.equal(s.saver.isOwnEcho("C"), true);
  assert.equal(s.saver.isOwnEcho("elsewhere"), false);
});

test("markLoaded replaces the baseline and drops a pending save", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.touch(s.read);
  assert.equal(s.saver.hasPending(), true);
  s.saver.markLoaded("Z");
  assert.equal(s.saver.hasPending(), false);
  s.timers.fire();
  assert.deepEqual(s.written, []);
});
