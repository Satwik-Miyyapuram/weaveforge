import assert from "node:assert/strict";
import { test } from "node:test";

import { decorate, plainText, slug, stripFrontMatter } from "../user-docs.mjs";

test("slug makes a task id from a heading", () => {
  assert.equal(slug("Create a note"), "create-a-note");
  assert.equal(slug("Import <code>.zip</code> files…"), "import-zip-files");
});

test("stripFrontMatter drops the covers/checked block only", () => {
  assert.equal(stripFrontMatter("---\ncovers:\n  - a\nchecked: 2026-11-14\n---\n# Notes\n"), "# Notes\n");
  assert.equal(stripFrontMatter("# Notes\n---\n"), "# Notes\n---\n");
});

test("plainText strips tags and squeezes space", () => {
  assert.equal(plainText("<p>Click <strong>New</strong>\n now.</p>"), "Click New now.");
});

const html = `<h2>How to</h2>
<h3>Create a note</h3>
<ol>
<li>Click <strong>New</strong>.</li>
<li>Two<ul>
<li>sub</li>
</ul>
</li>
</ol>
<h2>Limits</h2>
<ol>
<li>not a task</li>
</ol>`;

test("decorate numbers the steps under an h3 and links shots that exist", () => {
  const out = decorate(html, "notes", (key) => key === "notes/create-a-note/2");
  assert.match(out, /<h2 id="how-to">How to<\/h2>/);
  assert.match(out, /<h3 id="create-a-note">Create a note<\/h3>/);
  assert.match(out, /<ol class="docs-steps" data-task="create-a-note">/);
  assert.match(out, /<li class="wf-item docs-step" data-step="1">Click/);
  assert.match(out, /<li class="wf-item docs-step" data-step="2" data-shot="shots\/notes\/create-a-note\/2">Two<ul>\n<li>sub/);
  assert.match(out, /<h2 id="limits">Limits<\/h2>\n<ol>\n<li>not a task/);
});

test("decorate turns links to other pages into .html and blockquotes into callouts", () => {
  const out = decorate(
    '<p><a href="ink.md#pens">Ink</a> <a href="https://x.org/a.md">x</a></p>\n<blockquote>\n<p>[!TIP]\nHi</p>\n</blockquote>\n<blockquote>\n<p>Plain</p>\n</blockquote>',
    "notes",
    () => false,
  );
  assert.match(out, /href="ink.html#pens"/);
  assert.match(out, /href="https:\/\/x.org\/a.md"/);
  assert.match(out, /<div class="callout callout--tip"><div class="callout-title">Good to know<\/div><div class="callout-body">\n<p>Hi<\/p>\n<\/div><\/div>/);
  assert.match(out, /<div class="callout callout--note"><div class="callout-body">\n<p>Plain<\/p>\n<\/div><\/div>/);
});
