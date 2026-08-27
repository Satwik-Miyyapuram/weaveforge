import assert from "node:assert/strict";
import { test } from "node:test";

import { createVaultWatch } from "../src/vault-watch";

/** A watch whose clock and timers this test owns. */
function harness() {
  const batches: string[][] = [];
  const timers: (() => void)[] = [];
  let clock = 1_000;
  const watch = createVaultWatch({
    onChange: (paths) => batches.push(paths),
    now: () => clock,
    quietMs: 5,
    selfWriteWindowMs: 100,
    setTimeoutFn: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeoutFn: () => timers.pop(),
  });
  return {
    watch,
    batches,
    quiet: () => timers.splice(0).forEach((fire) => fire()),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test("an external change is reported once things go quiet", () => {
  const { watch, batches, quiet } = harness();
  watch.saw("notes/one.note.md");
  assert.deepEqual(batches, [], "nothing is reported before the folder settles");
  quiet();
  assert.deepEqual(batches, [["notes/one.note.md"]]);
});

test("one save arriving as several events is one batch", () => {
  const { watch, batches, quiet } = harness();
  // An atomic save lands as a write, a rename, and a write again.
  watch.saw("a.md");
  watch.saw("a.md");
  watch.saw("a.md");
  quiet();
  assert.deepEqual(batches, [["a.md"]]);
});

test("several files changing together are one batch, sorted", () => {
  const { watch, batches, quiet } = harness();
  watch.saw("b.md");
  watch.saw("a.md");
  quiet();
  assert.deepEqual(batches, [["a.md", "b.md"]]);
});

test("our own write is not news", () => {
  const { watch, batches, quiet } = harness();
  watch.noteSelfWrite("mirrored.md");
  watch.saw("mirrored.md");
  quiet();
  assert.deepEqual(batches, []);
});

test("an echo is forgiven once, not forever", () => {
  const { watch, batches, quiet } = harness();
  watch.noteSelfWrite("mirrored.md");
  watch.saw("mirrored.md");
  // Somebody edits the file the mirror has just written. That is real news.
  watch.saw("mirrored.md");
  quiet();
  assert.deepEqual(batches, [["mirrored.md"]]);
});

test("a change long after our write is reported", () => {
  const { watch, batches, quiet, advance } = harness();
  watch.noteSelfWrite("mirrored.md");
  advance(500);
  watch.saw("mirrored.md");
  quiet();
  assert.deepEqual(batches, [["mirrored.md"]]);
});

test("our write to one file does not hide a change to another", () => {
  const { watch, batches, quiet } = harness();
  watch.noteSelfWrite("mine.md");
  watch.saw("mine.md");
  watch.saw("theirs.md");
  quiet();
  assert.deepEqual(batches, [["theirs.md"]]);
});

test("stopping drops what was pending", () => {
  const { watch, batches, quiet } = harness();
  watch.saw("a.md");
  watch.stop();
  quiet();
  assert.deepEqual(batches, []);
});

test("a quiet folder reports nothing", () => {
  const { watch, batches, quiet } = harness();
  quiet();
  assert.deepEqual(batches, []);
});
