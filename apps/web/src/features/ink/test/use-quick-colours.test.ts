import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_TOOL_COLOURS, quickFrom } from "../ui/use-tool-colours";

const PEN = DEFAULT_TOOL_COLOURS.pen.quick;

test("a missing list gives the tool's five defaults", () => {
  assert.deepEqual(quickFrom(undefined, PEN), [...PEN]);
  assert.equal(PEN.length, 5);
});

test("a saved list is read back as saved", () => {
  const saved = ["pink", "yellow", "text", "danger", "purple"];
  assert.deepEqual(quickFrom(saved, PEN), saved);
});

test("a bad slot falls back alone; the rest are kept", () => {
  const read = quickFrom(["pink", "chartreuse", 7], PEN);
  assert.deepEqual(read, ["pink", PEN[1], PEN[2], PEN[3], PEN[4]]);
});

test("a value that is not a list is the defaults, not a throw", () => {
  assert.deepEqual(quickFrom("pink", PEN), [...PEN]);
  assert.deepEqual(quickFrom(null, PEN), [...PEN]);
});
