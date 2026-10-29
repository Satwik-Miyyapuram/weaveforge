import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyLinksTo, extractWikilinks, normalizeTitleKey, stripFrontmatter, uniqueTitle, wikilinkPattern } from "../../../src/features/vault/domain/vault-page.js";
import { markdownToLatex } from "../../../src/features/report/domain/markdown-to-latex.js";

test("one wikilink pattern serves notes and the LaTeX export (05-18)", () => {
  const text = "[[A|b]] [[x\ny]] [[[N]]] [[]] [[C#h]]";
  const raws = (s: string) => [...s.matchAll(wikilinkPattern())].map((m) => m[0]);
  assert.deepEqual(raws(text), ["[[A|b]]", "[[N]]", "[[C#h]]"]);
  assert.deepEqual(extractWikilinks(text).map((r) => r.raw), raws(text));

  // Each call is a fresh /g regex, so one caller's lastIndex cannot skip another's match.
  const first = wikilinkPattern();
  first.exec(text);
  assert.equal(wikilinkPattern().exec(text)?.[0], "[[A|b]]");

  const cites = new Map([["a", "ka"], ["n", "kn"], ["c", "kc"]]);
  const { citedKeys } = markdownToLatex(text.replaceAll("\n", " "), { citeByTitle: cites });
  assert.deepEqual(citedKeys, ["ka", "kn", "kc"]);
});

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
  assert.deepEqual(stripFrontmatter("no frontmatter"), { body: "no frontmatter", tags: [], aliases: [] });
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

test("stripFrontmatter trims quotes and stays linear on long runs", () => {
  assert.deepEqual(stripFrontmatter(`---\ntags:   "a", 'b'' , #c\n---\nx`).tags, ["a", "b", "c"]);
  const started = performance.now();
  stripFrontmatter(`---\ntags:${" ".repeat(50_000)}\n${'"'.repeat(50_000)}x\n---\n`);
  assert.ok(performance.now() - started < 500);
});

test("stripFrontmatter keeps multi-word aliases whole (05-11)", () => {
  const inline = stripFrontmatter("---\naliases: [Deep Learning, \"DL\"]\ntags: [ml nlp]\n---\nx");
  assert.deepEqual(inline.aliases, ["Deep Learning", "DL"]);
  assert.deepEqual(inline.tags, ["Deep-Learning", "DL", "ml", "nlp"]);
  const block = stripFrontmatter("---\naliases:\n  - 'Large  Language Model'\n  - LLM\n---\nx");
  assert.deepEqual(block.aliases, ["Large Language Model", "LLM"]);
  assert.deepEqual(block.tags, ["Large-Language-Model", "LLM"]);
  assert.deepEqual(stripFrontmatter("---\naliases:\n---\nx").aliases, []);
});
