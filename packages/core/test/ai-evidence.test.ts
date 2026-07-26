import assert from "node:assert/strict";
import test from "node:test";
import { highlightWithinExcerpt } from "../src/features/ai-assistant/domain/ai-evidence.js";
import type { PdfLocus } from "../src/reader/index.js";

const excerpt =
  "Prior work established the baseline. We show attention is all you need. Later sections expand on this.";

test("highlightWithinExcerpt splits the excerpt around the used sentence", () => {
  const locus: PdfLocus = {
    quote: { type: "TextQuoteSelector", exact: "attention is all you need" },
  };
  const hl = highlightWithinExcerpt(excerpt, locus);
  assert.ok(hl);
  assert.equal(hl!.match, "attention is all you need");
  assert.equal(hl!.before + hl!.match + hl!.after, excerpt);
  assert.equal(hl!.confidence, "high");
});

test("highlightWithinExcerpt reports low confidence for an ambiguous quote", () => {
  const repeated = "the model. the model. the model.";
  const hl = highlightWithinExcerpt(repeated, {
    quote: { type: "TextQuoteSelector", exact: "the model" },
  });
  assert.ok(hl);
  assert.equal(hl!.confidence, "low");
});

test("highlightWithinExcerpt returns null with no excerpt, no locus, or no match", () => {
  assert.equal(highlightWithinExcerpt("", { quote: { type: "TextQuoteSelector", exact: "x" } }), null);
  assert.equal(highlightWithinExcerpt(excerpt, undefined), null);
  assert.equal(
    highlightWithinExcerpt(excerpt, { quote: { type: "TextQuoteSelector", exact: "not present here" } }),
    null,
  );
});

test("highlightWithinExcerpt falls back to a position selector at low confidence", () => {
  const hl = highlightWithinExcerpt(excerpt, {
    quote: { type: "TextQuoteSelector", exact: "totally absent phrase" },
    position: { type: "TextPositionSelector", start: 0, end: 10 },
  });
  assert.ok(hl);
  assert.equal(hl!.confidence, "low");
  assert.equal(hl!.match, excerpt.slice(0, 10));
});
