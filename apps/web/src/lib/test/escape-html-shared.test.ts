/** Every string-built document escapes through `@/lib/escape-html` (xhelp-12). */

import assert from "node:assert/strict";
import { test } from "node:test";

import { readerPrintDocument } from "@/features/reader/application/reader-print";
import { readyCore } from "@/lib/rust-core";

const nasty = `a & b <i>"x"</i>`;

test("escapeHtml escapes the four markup characters", () => {
  assert.equal(readyCore().escapeHtml(nasty), "a &amp; b &lt;i&gt;&quot;x&quot;&lt;/i&gt;");
  assert.equal(readyCore().escapeHtml("plain"), "plain");
  assert.equal(readyCore().escapeHtml("&amp;"), "&amp;amp;");
});

test("print escaping is unchanged: title, quote and comment", () => {
  const html = readerPrintDocument({
    title: nasty,
    pages: [{ image: "data:image/jpeg;base64,AA", width: 1, height: 1, notes: [{ top: 0, colour: "#000", quote: nasty, comment: nasty }] }],
    withComments: true,
  });
  assert.ok(!html.includes("<i>"), "raw markup leaked");
  assert.ok(html.includes(readyCore().escapeHtml(nasty)));
});
