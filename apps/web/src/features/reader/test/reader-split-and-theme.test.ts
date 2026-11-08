import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldUseDarkPdfRendering } from "../application/reader-pdf-theme.js";
import { parseReaderSplitPane } from "../application/reader-split.js";

test("shouldUseDarkPdfRendering recognises dark theme ids", () => {
  assert.equal(shouldUseDarkPdfRendering("mocha"), true);
  assert.equal(shouldUseDarkPdfRendering("latte"), false);
  assert.equal(shouldUseDarkPdfRendering(null), false);
  assert.equal(shouldUseDarkPdfRendering(null, "dark"), true);
  assert.equal(shouldUseDarkPdfRendering("latte", "dark"), true);
});

// A PDF is someone else's printed page: it always renders light, whatever the
// app theme. Only the app around it (and HTML papers) follow the theme.
test("PDF pages always render light, never inverted for a dark theme", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const reader = read("../ui/pdf-reader/pdf-reader.tsx");
  assert.doesNotMatch(reader, /useDarkPdf|pdf-reader--dark|darkPdfCanvasFilter/);
  assert.doesNotMatch(read("../../../app/styles/reader.css"), /pdf-reader--dark|invert\(/);
});

test("parseReaderSplitPane accepts report|vault only", () => {
  assert.equal(parseReaderSplitPane("report"), "report");
  assert.equal(parseReaderSplitPane("vault"), "vault");
  assert.equal(parseReaderSplitPane("other"), null);
});

