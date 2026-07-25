import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseAnchorStrategy,
  type CombinedPdfAnchor,
  type PdfLocus,
} from "../src/reader/index.js";

const locus = (exact: string): PdfLocus => ({
  quote: { type: "TextQuoteSelector", exact },
});

test("chooseAnchorStrategy prefers rects when content hash matches", () => {
  const anchor: CombinedPdfAnchor = {
    contentHash: "abc",
    zoteroPosition: { pageIndex: 2, rects: [[1, 2, 3, 4]] },
    locus: locus("latent space"),
  };
  assert.deepEqual(chooseAnchorStrategy(anchor, "abc"), {
    kind: "rects",
    position: { pageIndex: 2, rects: [[1, 2, 3, 4]] },
    confidence: "high",
  });
});

test("chooseAnchorStrategy falls back to quote with low confidence on hash mismatch", () => {
  const quoteLocus = locus("latent space");
  const anchor: CombinedPdfAnchor = {
    contentHash: "old",
    zoteroPosition: { pageIndex: 0, rects: [[0, 0, 1, 1]] },
    locus: quoteLocus,
  };
  assert.deepEqual(chooseAnchorStrategy(anchor, "new"), {
    kind: "quote",
    locus: quoteLocus,
    confidence: "low",
  });
});

test("chooseAnchorStrategy uses quote when rects are absent", () => {
  const quoteLocus = locus("only quote");
  const anchor: CombinedPdfAnchor = {
    contentHash: "abc",
    locus: quoteLocus,
  };
  assert.deepEqual(chooseAnchorStrategy(anchor, "abc"), {
    kind: "quote",
    locus: quoteLocus,
    confidence: "low",
  });
});

test("chooseAnchorStrategy returns none when quote is absent but rects hash mismatches", () => {
  const anchor: CombinedPdfAnchor = {
    contentHash: "old",
    zoteroPosition: { pageIndex: 1, rects: [[0, 0, 10, 10]] },
  };
  assert.deepEqual(chooseAnchorStrategy(anchor, "new"), {
    kind: "none",
    confidence: "low",
  });
});

test("chooseAnchorStrategy returns none when neither rects nor quote are present", () => {
  assert.deepEqual(chooseAnchorStrategy({}, "any"), {
    kind: "none",
    confidence: "low",
  });
  assert.deepEqual(
    chooseAnchorStrategy({ locus: { quote: { type: "TextQuoteSelector", exact: "" } } }, "any"),
    { kind: "none", confidence: "low" },
  );
});
