import { test } from "node:test";
import assert from "node:assert/strict";
import { darkPdfCanvasFilter, shouldUseDarkPdfRendering } from "../application/reader-pdf-theme.js";
import { buildReaderSplitHref, parseReaderSplitPane } from "../application/reader-split.js";

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

test("buildReaderSplitHref encodes pane targets", () => {
  assert.equal(
    buildReaderSplitHref({ paperId: "p1", pane: "report", sectionId: "s1" }),
    "/reader?paper=p1&pane=report&section=s1",
  );
  assert.equal(
    buildReaderSplitHref({ paperId: "p1", pane: "vault", noteId: "n1" }),
    "/reader?paper=p1&pane=vault&note=n1",
  );
});
