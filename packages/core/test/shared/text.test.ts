import { test } from "node:test";
import assert from "node:assert/strict";
import { rust } from "../../src/shared/rust.js";



test("countWords counts whitespace-separated words (xhelp-17)", () => {
  assert.equal(rust().countWords(""), 0);
  assert.equal(rust().countWords("   \n\t "), 0);
  assert.equal(rust().countWords("one"), 1);
  assert.equal(rust().countWords("  one two   three  "), 3);
  assert.equal(rust().countWords("line\nbreak\ttab"), 3);
  assert.equal(rust().countWords("naïve café — ok"), 4);
});

test("the barrel exports the same countWords", () => {
  assert.equal(rust().countWords, rust().countWords);
});
