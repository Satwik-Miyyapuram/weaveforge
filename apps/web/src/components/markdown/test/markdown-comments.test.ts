/**
 * HTML comments are the file's own bookkeeping (the ink header, page markers,
 * template regions) and render as nothing (design D19, DA-100).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdownPlain, renderProseMarkdown } from "@/components/markdown/markdown";

test("the ink header renders nothing, on one line or several", () => {
  assert.equal(renderProseMarkdown('<!-- weaveforge-ink v=1 pages=2 -->\n# Title'), '<h1 id="title">Title</h1>');
  assert.equal(renderProseMarkdown("<!-- weaveforge-ink\n  v=1\n-->\nText"), "<p>Text</p>");
});

test("page markers between paragraphs render nothing", () => {
  assert.equal(renderProseMarkdown("One\n\n<!-- page 2 -->\n\nTwo"), "<p>One</p><p>Two</p>");
});

test("a comment closing on the same line as text keeps the text after it", () => {
  assert.equal(renderProseMarkdown("<!-- note -->Kept"), "<p>Kept</p>");
});

test("a comment that never closes is shown, not swallowing the note", () => {
  assert.match(renderProseMarkdown("<!-- open\nStill here"), /Still here/);
});

test("a comment inside a code fence is code, and stays", () => {
  assert.match(renderMarkdownPlain("```\n<!-- keep -->\n```"), /&lt;!-- keep --&gt;/);
});

test("a comment in the middle of a sentence is left as written", () => {
  assert.match(renderProseMarkdown("Use <!-- x --> here"), /&lt;!-- x --&gt;/);
});
