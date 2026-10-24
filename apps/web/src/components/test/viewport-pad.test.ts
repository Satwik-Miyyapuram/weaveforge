/** One viewport margin for every floating surface (xhelp-28). */

import assert from "node:assert/strict";
import { test } from "node:test";

import { VIEWPORT_PAD } from "../viewport-pad";

test("floating surfaces keep 12px from the viewport edge", () => {
  assert.equal(VIEWPORT_PAD, 12);
});
