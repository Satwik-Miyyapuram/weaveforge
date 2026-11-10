/** Every string-built document escapes through `@/lib/escape-html` (xhelp-12). */

import assert from "node:assert/strict";
import { before, test } from "node:test";

import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

const nasty = `a & b <i>"x"</i>`;

before(loadTestCore);

test("escapeHtml escapes the four markup characters", () => {
  assert.equal(readyCore().escapeHtml(nasty), "a &amp; b &lt;i&gt;&quot;x&quot;&lt;/i&gt;");
  assert.equal(readyCore().escapeHtml("plain"), "plain");
  assert.equal(readyCore().escapeHtml("&amp;"), "&amp;amp;");
});

test("print escaping is unchanged: title, quote and comment", () => {
  const html = readyCore().readerPrintDocument({
    title: nasty,
    pages: [{ image: "data:image/jpeg;base64,AA", width: 1, height: 1, notes: [{ top: 0, colour: "#000", quote: nasty, comment: nasty }] }],
    withComments: true,
  });
  assert.ok(!html.includes("<i>"), "raw markup leaked");
  assert.ok(html.includes(readyCore().escapeHtml(nasty)));
});
