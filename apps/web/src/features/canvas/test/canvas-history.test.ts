import { test } from "node:test";
import assert from "node:assert/strict";

import { HISTORY_LIMIT, canRedo, canUndo, createHistory, record, redo, undo } from "../application/canvas-history";

test("undo returns the snapshot before the last recorded change, and redo brings it back", () => {
  let h = createHistory("a");
  h = record(h, "b");
  h = record(h, "c");
  assert.equal(h.present, "c");
  h = undo(h);
  assert.equal(h.present, "b");
  h = undo(h);
  assert.equal(h.present, "a");
  h = redo(h);
  assert.equal(h.present, "b");
});

test("recording a change after an undo drops the redo branch", () => {
  let h = createHistory("a");
  h = record(h, "b");
  h = undo(h);
  h = record(h, "c");
  assert.equal(canRedo(h), false);
  assert.equal(h.present, "c");
});

test("nothing to undo or redo at the ends of the history", () => {
  const h = createHistory("a");
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);
  assert.equal(undo(h), h);
  assert.equal(redo(h), h);
});

test("recording the same snapshot again is not a change", () => {
  const h = createHistory("a");
  assert.equal(record(h, "a"), h);
});

test("the history keeps at most 50 earlier snapshots", () => {
  assert.equal(HISTORY_LIMIT, 50);
  let h = createHistory(0);
  for (let i = 1; i <= 80; i++) h = record(h, i);
  assert.equal(h.past.length, 50);
  let steps = 0;
  while (canUndo(h)) {
    h = undo(h);
    steps += 1;
  }
  assert.equal(steps, 50);
  assert.equal(h.present, 30);
});
