import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptablePrintPicture,
  printPreviewHtml,
  printPreviewTitle,
  PRINT_PREVIEW_MAX_BYTES,
} from "../src/print-preview";

test("acceptablePrintPicture takes a PNG data URL and nothing else", () => {
  assert.equal(acceptablePrintPicture("data:image/png;base64,iVBORw0KGgo="), true);
  assert.equal(acceptablePrintPicture("data:image/svg+xml;base64,PHN2Zz4="), false);
  assert.equal(acceptablePrintPicture("data:image/png;base64,<script>"), false);
  assert.equal(acceptablePrintPicture("https://example.com/a.png"), false);
  assert.equal(acceptablePrintPicture(42), false);
  assert.equal(
    acceptablePrintPicture(`data:image/png;base64,${"A".repeat(PRINT_PREVIEW_MAX_BYTES)}`),
    false,
  );
});

test("printPreviewTitle folds whitespace, bounds length, falls back", () => {
  assert.equal(printPreviewTitle("  note \n page 1 "), "note page 1");
  assert.equal(printPreviewTitle(""), "Print");
  assert.equal(printPreviewTitle(null), "Print");
  assert.equal(printPreviewTitle("x".repeat(300)).length, 200);
});

test("printPreviewHtml escapes the title and carries the print button", () => {
  const html = printPreviewHtml(`<b>"a" & 'b'</b>`);
  assert.ok(!html.includes("<b>"));
  assert.ok(html.includes("&#60;b&#62;&#34;a&#34; &#38; &#39;b&#39;"));
  assert.ok(html.includes('onclick="window.print()"'));
  assert.ok(html.includes('id="page"'));
});
