import { test } from "node:test";
import assert from "node:assert/strict";
import { darkPdfCanvasFilter, shouldUseDarkPdfRendering } from "../application/reader-pdf-theme.js";
import { parseReaderSplitPane } from "../application/reader-split.js";

test("shouldUseDarkPdfRendering recognises dark theme ids", () => {
  assert.equal(shouldUseDarkPdfRendering("mocha"), true);
  assert.equal(shouldUseDarkPdfRendering("latte"), false);
  assert.equal(shouldUseDarkPdfRendering(null), false);
  assert.equal(shouldUseDarkPdfRendering(null, "dark"), true);
  assert.equal(shouldUseDarkPdfRendering("latte", "dark"), true);
});

test("darkPdfCanvasFilter is stable", () => {
  assert.match(darkPdfCanvasFilter(), /invert/);
});

test("parseReaderSplitPane accepts report|vault only", () => {
  assert.equal(parseReaderSplitPane("report"), "report");
  assert.equal(parseReaderSplitPane("vault"), "vault");
  assert.equal(parseReaderSplitPane("other"), null);
});

