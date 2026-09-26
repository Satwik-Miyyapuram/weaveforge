import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_QUICK_COLOURS, parseQuickColours } from "../ui/use-quick-colours";

test("nothing saved gives the five defaults", () => {
  assert.deepEqual(parseQuickColours(null), [...DEFAULT_QUICK_COLOURS]);
  assert.equal(DEFAULT_QUICK_COLOURS.length, 5);
});

test("a saved list is read back as saved", () => {
  const saved = ["pink", "yellow", "text", "danger", "purple"];
  assert.deepEqual(parseQuickColours(JSON.stringify(saved)), saved);
});

test("a bad slot falls back alone; the rest are kept", () => {
  const read = parseQuickColours(JSON.stringify(["pink", "chartreuse", 7]));
  assert.deepEqual(read, ["pink", DEFAULT_QUICK_COLOURS[1], DEFAULT_QUICK_COLOURS[2], DEFAULT_QUICK_COLOURS[3], DEFAULT_QUICK_COLOURS[4]]);
});

test("junk is the defaults, not a throw", () => {
  assert.deepEqual(parseQuickColours("{not json"), [...DEFAULT_QUICK_COLOURS]);
  assert.deepEqual(parseQuickColours('"pink"'), [...DEFAULT_QUICK_COLOURS]);
});
