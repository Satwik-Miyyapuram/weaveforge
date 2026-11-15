import assert from "node:assert/strict";
import { test } from "node:test";

import { anchors, brokenLinks, extractLinks, slug } from "../doc-links.mjs";

const tracked = new Set(["docs/a.md", "docs/b.md", "docs/sub/c.md", "README.md"]);

test("a good relative link resolves", () => {
  const links = extractLinks("See [B](b.md).");
  assert.deepEqual(links, [{ target: "b.md", line: 1 }]);
  assert.deepEqual(brokenLinks("docs/a.md", links, tracked, () => ""), []);
});

test("a missing file is reported with its line", () => {
  const links = extractLinks("ok\n[x](nope.md)\n");
  assert.deepEqual(brokenLinks("docs/a.md", links, tracked, () => ""), [
    { line: 2, target: "nope.md", why: "not tracked" },
  ]);
});

test("a link to a directory that holds tracked files is fine", () => {
  const links = extractLinks("[x](sub)");
  assert.deepEqual(brokenLinks("docs/a.md", links, tracked, () => ""), []);
});

test("a leading slash resolves from the repo root", () => {
  const links = extractLinks("[x](/docs/b.md)");
  assert.deepEqual(brokenLinks("docs/a.md", links, tracked, () => ""), []);
});

test("a same-file anchor that exists is fine", () => {
  const md = "# Hello\n\n[x](#hello)";
  const links = extractLinks(md);
  assert.deepEqual(brokenLinks("docs/a.md", links, tracked, () => md), []);
});

test("a same-file anchor that is missing is reported", () => {
  const md = "# Hello\n\n[x](#nope)";
  const links = extractLinks(md);
  assert.deepEqual(brokenLinks("docs/a.md", links, tracked, () => md), [
    { line: 3, target: "#nope", why: "no heading #nope" },
  ]);
});

test("a cross-file anchor that exists is fine", () => {
  const links = extractLinks("[x](b.md#intro)");
  const read = (rel) => (rel === "docs/b.md" ? "## Intro" : "");
  assert.deepEqual(brokenLinks("docs/a.md", links, tracked, read), []);
});

test("a cross-file anchor that is missing is reported", () => {
  const links = extractLinks("[x](b.md#intro)");
  const read = (rel) => (rel === "docs/b.md" ? "## Other" : "");
  assert.deepEqual(brokenLinks("docs/a.md", links, tracked, read), [
    { line: 1, target: "b.md#intro", why: "no heading #intro" },
  ]);
});

test("a link inside a fenced code block is ignored", () => {
  assert.deepEqual(extractLinks("```md\n[x](missing.md)\n```\n"), []);
  assert.deepEqual(extractLinks("~~~\n[x](missing.md)\n~~~\n"), []);
});

test("a link inside an inline code span is ignored", () => {
  assert.deepEqual(extractLinks("Write `[x](missing.md)` literally."), []);
});

test("http, mailto, tel and data targets are ignored", () => {
  const md = "[a](https://example.com) [b](http://x.y) [c](mailto:a@b.c) [d](tel:+1) [e](data:text/plain,hi)";
  assert.deepEqual(extractLinks(md), []);
});

test("an optional title is stripped and images are included", () => {
  const md = '[x](b.md "Title")\n![alt](img/a.png)';
  assert.deepEqual(extractLinks(md), [
    { target: "b.md", line: 1 },
    { target: "img/a.png", line: 2 },
  ]);
});

test("duplicate headings get GitHub suffixes", () => {
  const set = anchors("# Setup\n\n## Setup\n\n### Setup");
  assert.ok(set.has("setup"));
  assert.ok(set.has("setup-1"));
  assert.ok(set.has("setup-2"));
});

test("headings outside fences count, headings inside fences do not", () => {
  const set = anchors("```\n# Not A Heading\n```\n# Real");
  assert.ok(set.has("real"));
  assert.ok(!set.has("not-a-heading"));
});

test("explicit a id and name anchors count", () => {
  const set = anchors('<a id="top"></a>\n<a name="old">x</a>');
  assert.ok(set.has("top"));
  assert.ok(set.has("old"));
});

test("slug strips backticks, emphasis and punctuation", () => {
  assert.equal(slug("`Foo` & Bar: Baz!"), "foo--bar-baz");
  assert.equal(slug("*Bold* text_x"), "bold-text_x");
  assert.equal(slug("Déjà vu"), "déjà-vu");
});
