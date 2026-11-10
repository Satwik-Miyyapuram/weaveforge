import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

test("a notice shows only under the entry it is about", () => {
  const notice = { index: 9, text: "Added to library" };
  assert.equal(readyCore().noticeFor(notice, 9), "Added to library");
  assert.equal(readyCore().noticeFor(notice, 10), null);
  assert.equal(readyCore().noticeFor(null, 9), null);
});

test("an add that found the paper already there does not claim it added it", () => {
  assert.equal(readyCore().addedNotice(true), "Added to library");
  assert.equal(readyCore().addedNotice(false), "Already in library");
});
