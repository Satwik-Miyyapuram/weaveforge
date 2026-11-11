/**
 * One reading of "this paper has no summary" (xhelp-25): four web files each
 * compared against their own copy of the old placeholder text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_SUMMARY } from "../../../src/features/papers/domain/parts.js";
import { rust } from "../../../src/shared/rust.js";

test("the placeholder is the text old rows were saved with", () => {
  assert.equal(NO_SUMMARY, "No summary yet.");
});

test("missing, blank and placeholder summaries are empty", () => {
  assert.equal(rust().isEmptyPaperSummary(undefined), true);
  assert.equal(rust().isEmptyPaperSummary(null), true);
  assert.equal(rust().isEmptyPaperSummary(""), true);
  assert.equal(rust().isEmptyPaperSummary(NO_SUMMARY), true);
});

test("a written summary is not empty, even one that mentions the placeholder", () => {
  assert.equal(rust().isEmptyPaperSummary("Good paper."), false);
  assert.equal(rust().isEmptyPaperSummary("No summary yet. Then I wrote one."), false);
  assert.equal(rust().isEmptyPaperSummary("no summary yet."), false);
});
