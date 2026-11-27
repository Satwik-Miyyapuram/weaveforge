/**
 * Reopening a PDF re-extracts its text. When it matches what is stored, the
 * reader skips the save and the reindex, so a reopen costs no write.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PdfIndexSource } from "@weaveforge/wasm";
import { samePdfText } from "../infrastructure/parts-2";

const source = (title: string, ...texts: string[]): PdfIndexSource =>
  ({
    paperId: "p1",
    title,
    pages: texts.map((text, pageIndex) => ({ pageIndex, text })),
    extractedAt: new Date().toISOString(),
  }) as unknown as PdfIndexSource;

test("the same title and pages match, whatever the extraction time", () => {
  assert.equal(samePdfText(source("A", "one", "two"), source("A", "one", "two")), true);
});

test("a changed page, an extra page or a new title does not match", () => {
  assert.equal(samePdfText(source("A", "one", "two"), source("A", "one", "TWO")), false);
  assert.equal(samePdfText(source("A", "one"), source("A", "one", "two")), false);
  assert.equal(samePdfText(source("A", "one"), source("B", "one")), false);
});

test("nothing stored never matches", () => {
  assert.equal(samePdfText(undefined, source("A", "one")), false);
});
