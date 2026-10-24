/**
 * One reading of "this paper has no summary" (xhelp-25): four web files each
 * compared against their own copy of the old placeholder text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_SUMMARY, isEmptyPaperSummary } from "../../../src/features/papers/domain/paper.js";

test("the placeholder is the text old rows were saved with", () => {
  assert.equal(NO_SUMMARY, "No summary yet.");
});

test("missing, blank and placeholder summaries are empty", () => {
  assert.equal(isEmptyPaperSummary(undefined), true);
  assert.equal(isEmptyPaperSummary(null), true);
  assert.equal(isEmptyPaperSummary(""), true);
  assert.equal(isEmptyPaperSummary(NO_SUMMARY), true);
});

test("a written summary is not empty, even one that mentions the placeholder", () => {
  assert.equal(isEmptyPaperSummary("Good paper."), false);
  assert.equal(isEmptyPaperSummary("No summary yet. Then I wrote one."), false);
  assert.equal(isEmptyPaperSummary("no summary yet."), false);
});
