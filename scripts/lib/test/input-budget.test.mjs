import assert from "node:assert/strict";
import { test } from "node:test";

import { INPUT_BUDGET, checkInputBudget, perEvent } from "../input-budget.mjs";

test("perEvent averages each metric over the events", () => {
  const before = { LayoutCount: 10, RecalcStyleCount: 4, ScriptDuration: 0.5 };
  const after = { LayoutCount: 30, RecalcStyleCount: 24, ScriptDuration: 0.7 };
  assert.deepEqual(perEvent(before, after, 10, 20), { outsideMutations: 0.5, layouts: 1, styleRecalcs: 1, scriptMs: 10 });
});

test("perEvent counts a metric missing from a snapshot as zero", () => {
  assert.deepEqual(perEvent({}, { LayoutCount: 4 }, 0, 4), { outsideMutations: 0, layouts: 1, styleRecalcs: 0, scriptMs: 0 });
});

test("perEvent refuses zero events", () => {
  assert.throws(() => perEvent({}, {}, 0, 0), RangeError);
});

test("a keystroke exactly at budget passes", () => {
  assert.deepEqual(checkInputBudget("key", { ...INPUT_BUDGET.key }), []);
});

test("a keystroke over budget names each broken metric", () => {
  assert.deepEqual(checkInputBudget("key", { outsideMutations: 1, layouts: 2, styleRecalcs: 4, scriptMs: 8 }), [
    "key outsideMutations 1 > 0 per event",
    "key styleRecalcs 4 > 3 per event",
  ]);
});

test("a pen move over the script budget fails", () => {
  assert.deepEqual(checkInputBudget("pen", { outsideMutations: 0, layouts: 1, styleRecalcs: 2, scriptMs: 4.5 }), [
    "pen scriptMs 4.5 > 4 per event",
  ]);
});

test("an unknown kind is refused", () => {
  assert.throws(() => checkInputBudget("mouse", {}), RangeError);
});
