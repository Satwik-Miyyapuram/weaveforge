/**
 * The lists screen's leftover notice tells the user what happens next. A
 * leftover is not cleared by saving its list (saving never touches members);
 * it is retried each time the lists load, so the notice must say that.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReadingListLegacyLeftover } from "@weaveforge/core";
import { leftoverNoticeText } from "../application/leftover-notice";

const LEFTOVER = {
  listId: "list-1",
  legacyLink: "[[Smith 2020]]",
  paperId: undefined,
  vaultPageId: undefined,
} as unknown as ReadingListLegacyLeftover;

test("the notice names the member and the list by name, not by id", () => {
  const text = leftoverNoticeText([LEFTOVER], (id) => (id === "list-1" ? "Thesis reading" : id));
  assert.match(text, /\[\[Smith 2020\]\] \(list Thesis reading\)/);
  assert.doesNotMatch(text, /list-1/);
});

test("the notice does not tell the user to save the list, which does not clear a leftover", () => {
  const text = leftoverNoticeText([LEFTOVER], (id) => id);
  assert.doesNotMatch(text, /save/i);
});

test("the notice says a leftover is retried when the lists load and how it moves in", () => {
  const text = leftoverNoticeText([LEFTOVER], (id) => id);
  assert.match(text, /retried when the lists load/);
  assert.match(text, /its link resolves to a paper or note/);
});

test("the count wording follows the number of leftovers", () => {
  assert.match(leftoverNoticeText([LEFTOVER], (id) => id), /^One member from an older list file is not shown as an item yet:/);
  assert.match(
    leftoverNoticeText([LEFTOVER, LEFTOVER], (id) => id),
    /^2 members from an older list file are not shown as items yet:/,
  );
});
