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

test("chooseAnchorStrategy ignores empty or missing rect arrays even when hash matches", () => {
  const quoteLocus = locus("fallback quote");
  assert.deepEqual(
    chooseAnchorStrategy(
      {
        contentHash: "abc",
        zoteroPosition: { pageIndex: 0 },
        locus: quoteLocus,
      },
      "abc",
    ),
    { kind: "quote", locus: quoteLocus, confidence: "low" },
  );
  assert.deepEqual(
    chooseAnchorStrategy(
      {
        contentHash: "abc",
        zoteroPosition: { pageIndex: 0, rects: [] },
        locus: quoteLocus,
      },
      "abc",
    ),
    { kind: "quote", locus: quoteLocus, confidence: "low" },
  );
  assert.deepEqual(
    chooseAnchorStrategy(
      {
        contentHash: "abc",
        zoteroPosition: { pageIndex: 0, rects: [[]] },
        locus: quoteLocus,
      },
      "abc",
    ),
    { kind: "quote", locus: quoteLocus, confidence: "low" },
  );
  assert.deepEqual(
    chooseAnchorStrategy(
      {
        contentHash: "abc",
        zoteroPosition: { pageIndex: 0, rects: [[NaN, NaN, NaN, NaN]] },
        locus: quoteLocus,
      },
      "abc",
    ),
    { kind: "quote", locus: quoteLocus, confidence: "low" },
  );
  assert.deepEqual(
    chooseAnchorStrategy(
      {
        contentHash: "abc",
        zoteroPosition: { pageIndex: 1.5, rects: [[1, 2, 3, 4]] },
        locus: quoteLocus,
      },
      "abc",
    ),
    { kind: "quote", locus: quoteLocus, confidence: "low" },
  );
});

test("chooseAnchorStrategy ignores empty hashes and whitespace-only quotes", () => {
  assert.deepEqual(
    chooseAnchorStrategy(
      {
        contentHash: "",
        zoteroPosition: { pageIndex: 0, rects: [[1, 2, 3, 4]] },
        locus: locus("quote"),
      },
      "",
    ),
    { kind: "quote", locus: locus("quote"), confidence: "low" },
  );
  assert.deepEqual(
    chooseAnchorStrategy({ locus: locus("   ") }, "abc"),
    { kind: "none", confidence: "low" },
  );
});
