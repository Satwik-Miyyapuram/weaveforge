import { test } from "node:test";
import assert from "node:assert/strict";
import { addedNotice, noticeFor } from "../application/reference-notice";

test("a notice shows only under the entry it is about", () => {
  const notice = { index: 9, text: "Added to library" };
  assert.equal(noticeFor(notice, 9), "Added to library");
  assert.equal(noticeFor(notice, 10), null);
  assert.equal(noticeFor(null, 9), null);
});

test("an add that found the paper already there does not claim it added it", () => {
  assert.equal(addedNotice(true), "Added to library");
  assert.equal(addedNotice(false), "Already in library");
});
