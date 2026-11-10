import { test } from "node:test";
import assert from "node:assert/strict";
import { rust } from "../../../src/shared/rust.js";


test("wikilink extraction and the LaTeX export share one rule (05-18)", () => {
  const text = "[[A|b]] [[x\ny]] [[[N]]] [[]] [[C#h]]";
  assert.deepEqual(rust().extractWikilinks(text).map((r) => r.raw), ["[[A|b]]", "[[N]]", "[[C#h]]"]);

  const cites = new Map([["a", "ka"], ["n", "kn"], ["c", "kc"]]);
  const { citedKeys } = rust().markdownToLatex(text.replaceAll("\n", " "), { citeByTitle: cites });
  assert.deepEqual(citedKeys, ["ka", "kn", "kc"]);
});

test("parses a plain wikilink", () => {
  const [ref] = rust().extractWikilinks("see [[Methods]] here");
  assert.equal(ref?.target, "Methods");
  assert.equal(ref?.alias, undefined);
  assert.equal(ref?.raw, "[[Methods]]");
});

test("parses alias, heading and block forms", () => {
  const refs = rust().extractWikilinks("[[Note|shown]] [[Chapter 2#Results]] [[Note#^abc123]]");
  assert.equal(refs[0]?.target, "Note");
  assert.equal(refs[0]?.alias, "shown");
  assert.equal(refs[1]?.target, "Chapter 2");
  assert.equal(refs[1]?.heading, "Results");
  assert.equal(refs[2]?.target, "Note");
  assert.equal(refs[2]?.block, "abc123");
});

test("ignores links inside inline and fenced code", () => {
  const refs = rust().extractWikilinks("`[[NotThis]]` and\n```\n[[NorThis]]\n```\nbut [[This]]");
  assert.deepEqual(refs.map((r) => r.target), ["This"]);
});

test("trims whitespace and handles same-note heading", () => {
  const [ref] = rust().extractWikilinks("[[  #Intro  ]]");
  assert.equal(ref?.target, "");
  assert.equal(ref?.heading, "Intro");
});

test("returns empty for no body or no links", () => {
  assert.deepEqual(rust().extractWikilinks(), []);
  assert.deepEqual(rust().extractWikilinks("plain text, no links"), []);
});

test("normalizeTitleKey folds case and collapses whitespace", () => {
  assert.equal(rust().normalizeTitleKey("  My   Note "), "my note");
  assert.equal(rust().normalizeTitleKey("MY NOTE"), "my note");
});

test("stripFrontmatter removes YAML and collects tags (inline, csv, block)", () => {
  assert.deepEqual(rust().stripFrontmatter("no frontmatter"), { body: "no frontmatter", tags: [], aliases: [] });
  const inline = rust().stripFrontmatter("---\ntags: [ml, nlp]\n---\nbody");
  assert.equal(inline.body, "body");
  assert.deepEqual(inline.tags, ["ml", "nlp"]);
  const block = rust().stripFrontmatter("---\naliases:\n  - Foo\ntags:\n  - a\n  - b\n---\ntext");
  assert.equal(block.body, "text");
  assert.deepEqual(block.tags.sort(), ["Foo", "a", "b"]);
});

test("uniqueTitle suffixes on case-insensitive collision", () => {
  const used = new Set<string>(["methods"]);
  assert.equal(rust().uniqueTitle("Methods", used), "Methods (2)");
  assert.equal(rust().uniqueTitle("methods", used), "methods (3)");
  assert.equal(rust().uniqueTitle("New", used), "New");
});

test("bodyLinksTo matches wikilink targets case-insensitively", () => {
  assert.equal(rust().bodyLinksTo("see [[My Note]] here", rust().normalizeTitleKey("my note")), true);
  assert.equal(rust().bodyLinksTo("[[Other|alias]]", rust().normalizeTitleKey("other")), true);
  assert.equal(rust().bodyLinksTo("no links", rust().normalizeTitleKey("my note")), false);
  assert.equal(rust().bodyLinksTo(undefined, "x"), false);
});

test("stripFrontmatter trims quotes and stays linear on long runs", () => {
  assert.deepEqual(rust().stripFrontmatter(`---\ntags:   "a", 'b'' , #c\n---\nx`).tags, ["a", "b", "c"]);
  const started = performance.now();
  rust().stripFrontmatter(`---\ntags:${" ".repeat(50_000)}\n${'"'.repeat(50_000)}x\n---\n`);
  assert.ok(performance.now() - started < 500);
});

test("stripFrontmatter keeps multi-word aliases whole (05-11)", () => {
  const inline = rust().stripFrontmatter("---\naliases: [Deep Learning, \"DL\"]\ntags: [ml nlp]\n---\nx");
  assert.deepEqual(inline.aliases, ["Deep Learning", "DL"]);
  assert.deepEqual(inline.tags, ["Deep-Learning", "DL", "ml", "nlp"]);
  const block = rust().stripFrontmatter("---\naliases:\n  - 'Large  Language Model'\n  - LLM\n---\nx");
  assert.deepEqual(block.aliases, ["Large Language Model", "LLM"]);
  assert.deepEqual(block.tags, ["Large-Language-Model", "LLM"]);
  assert.deepEqual(rust().stripFrontmatter("---\naliases:\n---\nx").aliases, []);
});
