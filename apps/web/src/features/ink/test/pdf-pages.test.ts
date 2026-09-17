import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllPages,
  pageListProblem,
  parsePageList,
  selectedPdfPages,
} from "../application/pdf-pages";

test("a number, a list and ranges name their pages, deduplicated and sorted", () => {
  assert.deepEqual(parsePageList("3").pages, [3]);
  assert.deepEqual(parsePageList(" 1 , 3 ,5 ").pages, [1, 3, 5]);
  assert.deepEqual(parsePageList("1-3").pages, [1, 2, 3]);
  assert.deepEqual(parsePageList("1, 3-5, 2").pages, [1, 2, 3, 4, 5]);
  assert.deepEqual(parsePageList("2-2").pages, [2]);
});

test("an open-ended or reversed range is read generously", () => {
  // "4-" names everything from 4 on; the bounds are the count's job.
  assert.deepEqual(parsePageList("4-").pages, [4]);
  assert.deepEqual(parsePageList(" -3").pages, [1, 2, 3]);
  // Either way round: the writer meant the same three pages.
  assert.deepEqual(parsePageList("5-3").pages, [3, 4, 5]);
});

test("junk is skipped rather than thrown: a wrong key still leaves the rest", () => {
  assert.deepEqual(parsePageList("1,x,3").pages, [1, 3]);
  assert.deepEqual(parsePageList("").pages, []);
  assert.deepEqual(parsePageList(",,,").pages, []);
  assert.deepEqual(parsePageList("0").pages, []);
  assert.deepEqual(parsePageList("-").pages, []);
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
