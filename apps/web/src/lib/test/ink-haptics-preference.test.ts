import { before, test } from "node:test";
import assert from "node:assert/strict";

import { loadTestCore } from "@/lib/test/load-test-core";
import { parseInkHapticsOn } from "../parts";

before(loadTestCore);

test("ink haptics preference: on unless stored off", () => {
  assert.equal(parseInkHapticsOn(null), true);
  assert.equal(parseInkHapticsOn("on"), true);
  assert.equal(parseInkHapticsOn("junk"), true);
  assert.equal(parseInkHapticsOn("off"), false);
});
