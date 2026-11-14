import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decorate,
  fasterWay,
  listItems,
  noteSteps,
  plainText,
  readMinutes,
  relatedStems,
  sections,
  slug,
  stripFrontMatter,
  stuckToDetails,
  tableFacts,
} from "../user-docs.mjs";

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

test("decorate numbers the steps under an h3 and links the views that show them", () => {
  const out = decorate(html, "notes", (key) => (key === "notes/create-a-note/2" ? "notes/hero.html" : null));
  assert.match(out, /<h2 id="how-to">How to<\/h2>/);
  assert.match(out, /<h3 id="create-a-note">Create a note<\/h3>/);
  assert.match(out, /<ol class="docs-steps" data-task="create-a-note">/);
  assert.match(out, /<li class="wf-item docs-step" data-step="1" data-ring="notes\/create-a-note\/1">Click/);
  assert.match(out, /<li class="wf-item docs-step" data-step="2" data-view="views\/notes\/hero.html" data-ring="notes\/create-a-note\/2">Two<ul>\n<li>sub/);
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
test("sections splits a page at its h2s", () => {
  const out = sections('<h1>Reader</h1>\n<p>Intro</p>\n<h2 id="how-to">How to</h2>\n<p>a</p>\n<h2 id="stuck">Stuck?</h2>\n<p>b</p>');
  assert.equal(out.head, "<h1>Reader</h1>\n<p>Intro</p>\n");
  assert.deepEqual(out.parts, [
    { id: "how-to", title: "How to", body: "<p>a</p>\n" },
    { id: "stuck", title: "Stuck?", body: "<p>b</p>" },
  ]);
  assert.equal(sections('<h2 id="a">A</h2>x').head, "");
});

test("stuckToDetails folds both question styles and keeps other paragraphs", () => {
  const out = stuckToDetails(
    "<p><strong>Q: Why grey?</strong>\nA: Fill the <strong>Email</strong> box.</p>\n<p><em>Did it fail?</em>\nProbably not.</p>\n<p>Plain.</p>",
  );
  assert.equal(
    out,
    '<details class="docs-stuck"><summary>Why grey?</summary><p>Fill the <strong>Email</strong> box.</p></details>\n' +
      '<details class="docs-stuck"><summary>Did it fail?</summary><p>Probably not.</p></details>\n<p>Plain.</p>',
  );
});

test("relatedStems reads the page links of a Related list", () => {
  const body = '<ul>\n<li><a href="search.html">Search</a> — finding</li>\n<li><a href="sync.html#x">Sync</a></li>\n<li><a href="https://x.org">x</a></li>\n</ul>';
  assert.deepEqual(relatedStems(body), ["search", "sync"]);
});

test("tableFacts reads the first rows of the first table", () => {
  const body =
    "<table>\n<thead>\n<tr>\n<th>Setting</th>\n<th>Value</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>Zoom</td>\n<td>100%</td>\n</tr>\n<tr>\n<td>Step</td>\n<td><code>1.25</code></td>\n</tr>\n</tbody></table>";
  assert.deepEqual(tableFacts(body, 4), [["Zoom", "100%"], ["Step", "1.25"]]);
  assert.deepEqual(tableFacts(body, 1), [["Zoom", "100%"]]);
  assert.deepEqual(tableFacts("<p>none</p>", 4), []);
});

test("listItems returns the items of a list", () => {
  assert.deepEqual(listItems("<ul>\n<li>One <b>x</b></li>\n<li>Two</li>\n</ul>"), ["One <b>x</b>", "Two"]);
});

test("fasterWay finds the first sentence with a key shortcut", () => {
  assert.equal(fasterWay("Open it. Press Ctrl+Shift+P to print. Done."), "Press Ctrl+Shift+P to print.");
  assert.equal(fasterWay("No keys here."), "");
});

test("readMinutes counts 200 words a minute, at least one", () => {
  assert.equal(readMinutes("word ".repeat(450)), 2);
  assert.equal(readMinutes("short"), 1);
});

test("noteSteps adds a step count note after each how-to heading", () => {
  const body =
    '<h3 id="a">A</h3>\n<ol class="docs-steps" data-task="a">\n<li class="wf-item docs-step" data-step="1">x</li>\n<li class="wf-item docs-step" data-step="2">y</li>\n</ol>\n<h3 id="b">B</h3>\n<p>no steps</p>';
  const out = noteSteps(body);
  assert.match(out, /<h3 id="a">A<\/h3><span class="docs-hand docs-aside-note">2 steps<\/span>/);
  assert.match(out, /<h3 id="b">B<\/h3>\n<p>no steps/);
});
