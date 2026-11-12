import assert from "node:assert/strict";
import test, { before } from "node:test";

import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

/**
 * The background indexer reads page text the way the reader does (27-03): a
 * newline after each line-ending run, so the last word of a line is not glued
 * to the first word of the next. The join itself is tested in Rust
 * (`reader_analysis::lines`); these cases cover the wasm adapter that reads
 * the pdf.js text items, which is the part still on the TS side.
 */
test("words at line ends stay separate, as the reader writes them", () => {
  const items = [
    { str: "the end of", hasEOL: true },
    { type: "beginMarkedContent" },
    { str: "line two", hasEOL: false },
    { type: "endMarkedContent" },
  ];
  assert.equal(readyCore().pdfPageText(items), "the end of\nline two");
});

test("a page with no text runs is empty", () => {
  assert.equal(readyCore().pdfPageText([]), "");
  assert.equal(readyCore().pdfPageText([{ type: "beginMarkedContent" }]), "");
});
