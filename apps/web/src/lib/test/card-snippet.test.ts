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
  assert.equal(cardSnippet("# Title\n\nSome *body*"), "Some body");
  assert.equal(cardSnippet("abcdef", 3), "abc…");
});

test("a card preview drops front matter, headings and tables (DA-28)", () => {
  const body = [
    "---",
    "title: Draft",
    "tags: [a]",
    "---",
    "# Draft",
    "",
    "| col | col |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "## Method",
    "First real sentence.",
  ].join("\n");
  assert.equal(cardSnippet(body), "First real sentence.");
});

test("a horizontal rule mid-note is not read as front matter", () => {
  assert.match(cardSnippet("Intro.\n\n---\n\nMore."), /^Intro\..*More\.$/);
});
