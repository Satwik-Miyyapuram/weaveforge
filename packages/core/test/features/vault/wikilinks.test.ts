import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyLinksTo, extractWikilinks, normalizeTitleKey, stripFrontmatter, uniqueTitle } from "../../../src/features/vault/domain/vault-page.js";

test("parses a plain wikilink", () => {
  const [ref] = extractWikilinks("see [[Methods]] here");
  assert.equal(ref?.target, "Methods");
  assert.equal(ref?.alias, undefined);
  assert.equal(ref?.raw, "[[Methods]]");
});

test("parses alias, heading and block forms", () => {
  const refs = extractWikilinks("[[Note|shown]] [[Chapter 2#Results]] [[Note#^abc123]]");
  assert.equal(refs[0]?.target, "Note");
  assert.equal(refs[0]?.alias, "shown");
  assert.equal(refs[1]?.target, "Chapter 2");
  assert.equal(refs[1]?.heading, "Results");
  assert.equal(refs[2]?.target, "Note");
  assert.equal(refs[2]?.block, "abc123");
});

test("ignores links inside inline and fenced code", () => {
  const refs = extractWikilinks("`[[NotThis]]` and\n```\n[[NorThis]]\n```\nbut [[This]]");
  assert.deepEqual(refs.map((r) => r.target), ["This"]);
});

test("trims whitespace and handles same-note heading", () => {
  const [ref] = extractWikilinks("[[  #Intro  ]]");
  assert.equal(ref?.target, "");
  assert.equal(ref?.heading, "Intro");
});

test("returns empty for no body or no links", () => {
  assert.deepEqual(extractWikilinks(), []);
  assert.deepEqual(extractWikilinks("plain text, no links"), []);
});

test("normalizeTitleKey folds case and collapses whitespace", () => {
  assert.equal(normalizeTitleKey("  My   Note "), "my note");
  assert.equal(normalizeTitleKey("MY NOTE"), "my note");
});

test("stripFrontmatter removes YAML and collects tags (inline, csv, block)", () => {
  assert.deepEqual(stripFrontmatter("no frontmatter"), { body: "no frontmatter", tags: [] });
  const inline = stripFrontmatter("---\ntags: [ml, nlp]\n---\nbody");
  assert.equal(inline.body, "body");
  assert.deepEqual(inline.tags, ["ml", "nlp"]);
  const block = stripFrontmatter("---\naliases:\n  - Foo\ntags:\n  - a\n  - b\n---\ntext");
  assert.equal(block.body, "text");
  assert.deepEqual(block.tags.sort(), ["Foo", "a", "b"]);
});

test("uniqueTitle suffixes on case-insensitive collision", () => {
  const used = new Set<string>(["methods"]);
  assert.equal(uniqueTitle("Methods", used), "Methods (2)");
  assert.equal(uniqueTitle("methods", used), "methods (3)");
  assert.equal(uniqueTitle("New", used), "New");
});

test("bodyLinksTo matches wikilink targets case-insensitively", () => {
  assert.equal(bodyLinksTo("see [[My Note]] here", normalizeTitleKey("my note")), true);
  assert.equal(bodyLinksTo("[[Other|alias]]", normalizeTitleKey("other")), true);
  assert.equal(bodyLinksTo("no links", normalizeTitleKey("my note")), false);
  assert.equal(bodyLinksTo(undefined, "x"), false);
});
