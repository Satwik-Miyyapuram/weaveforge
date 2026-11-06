import { test } from "node:test";
import assert from "node:assert/strict";

import { parseInkHapticsOn } from "../ink-haptics-preference";

test("ink haptics preference: on unless stored off", () => {
  assert.equal(parseInkHapticsOn(null), true);
  assert.equal(parseInkHapticsOn("on"), true);
  assert.equal(parseInkHapticsOn("junk"), true);
  assert.equal(parseInkHapticsOn("off"), false);
});
