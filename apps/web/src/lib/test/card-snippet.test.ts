import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_SUMMARY } from "@weaveforge/core";
import { cardSnippet } from "../card-snippet";

test("a card shows nothing for an empty or placeholder summary", () => {
  assert.equal(cardSnippet(""), "");
  assert.equal(cardSnippet(NO_SUMMARY), "");
  assert.equal(cardSnippet(`  **${NO_SUMMARY}**  `), "");
});

test("a card shows written text, markup stripped and cut to its budget", () => {
  assert.equal(cardSnippet("# Title\n\nSome *body*"), "Title Some body");
  assert.equal(cardSnippet("abcdef", 3), "abc…");
});
