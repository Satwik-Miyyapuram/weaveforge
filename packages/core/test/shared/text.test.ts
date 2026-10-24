import { test } from "node:test";
import assert from "node:assert/strict";
import { countWords } from "../../src/shared/text.js";
import { countWords as fromBarrel } from "../../src/index.js";

test("countWords counts whitespace-separated words (xhelp-17)", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   \n\t "), 0);
  assert.equal(countWords("one"), 1);
  assert.equal(countWords("  one two   three  "), 3);
  assert.equal(countWords("line\nbreak\ttab"), 3);
  assert.equal(countWords("naïve café — ok"), 4);
});

test("the barrel exports the same countWords", () => {
  assert.equal(fromBarrel, countWords);
});
