import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllPages,
  pageListProblem,
  parsePageList,
  selectedPdfPages,
} from "../application/pdf-pages";

test("a number, a list and ranges name their pages, deduplicated and sorted", () => {
  assert.deepEqual(parsePageList("3", 9).pages, [3]);
  assert.deepEqual(parsePageList(" 1 , 3 ,5 ", 9).pages, [1, 3, 5]);
  assert.deepEqual(parsePageList("1-3", 9).pages, [1, 2, 3]);
  assert.deepEqual(parsePageList("1, 3-5, 2", 9).pages, [1, 2, 3, 4, 5]);
  assert.deepEqual(parsePageList("2-2", 9).pages, [2]);
});

test("an open-ended or reversed range is read generously", () => {
  // "4-" names everything from 4 to the last page (18-02).
  assert.deepEqual(parsePageList("4-", 6).pages, [4, 5, 6]);
  assert.deepEqual(selectedPdfPages("2-", 3), [2, 3]);
  assert.deepEqual(parsePageList(" -3", 9).pages, [1, 2, 3]);
  // Either way round: the writer meant the same three pages.
  assert.deepEqual(parsePageList("5-3", 9).pages, [3, 4, 5]);
});

test("junk is skipped rather than thrown: a wrong key still leaves the rest", () => {
  assert.deepEqual(parsePageList("1,x,3", 9).pages, [1, 3]);
  assert.deepEqual(parsePageList("", 9).pages, []);
  assert.deepEqual(parsePageList(",,,", 9).pages, []);
  assert.deepEqual(parsePageList("0", 9).pages, []);
  assert.deepEqual(parsePageList("-", 9).pages, []);
});

test("'all' means every page, and only bounds are applied after it", () => {
  assert.equal(isAllPages("all"), true);
  assert.equal(isAllPages(" ALL "), true);
  assert.equal(isAllPages("all 3"), false);
  assert.deepEqual(selectedPdfPages("all", 4), [1, 2, 3, 4]);
  // A list is filtered to the pages the document actually has.
  assert.deepEqual(selectedPdfPages("1,3-9", 4), [1, 3, 4]);
});

test("the validation line names the page that is out of range", () => {
  assert.equal(pageListProblem("1,3-5", 8), null);
  assert.equal(pageListProblem("all", 8), null);
  assert.equal(pageListProblem("1,9", 8), "Page 9 is outside this PDF, which has 8.");
  assert.equal(pageListProblem("???", 8), 'Enter a page, a list like 1,3-5, or "all".');
  assert.equal(pageListProblem("2", 1), "Page 2 is outside this PDF, which has 1.");
});

test("a huge range is bounded by the page count, not walked (18-03)", () => {
  const started = Date.now();
  assert.deepEqual(selectedPdfPages("1-99999999", 3), [1, 2, 3]);
  assert.deepEqual(selectedPdfPages("2-999999999999", 2), [2]);
  assert.equal(
    pageListProblem("1-99999999", 3),
    "Page 4 is outside this PDF, which has 3.",
  );
  assert.equal(pageListProblem("5-", 3), "Page 5 is outside this PDF, which has 3.");
  assert.equal(pageListProblem("3-9", 8), "Page 9 is outside this PDF, which has 8.");
  assert.ok(Date.now() - started < 200);
});
