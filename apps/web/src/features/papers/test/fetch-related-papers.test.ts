import assert from "node:assert/strict";
import test from "node:test";
import { resolveRelatedPaperUrl } from "../application/fetch-related-papers";

test("resolveRelatedPaperUrl prefers explicit url, then DOI, then arXiv", () => {
  assert.equal(
    resolveRelatedPaperUrl({ url: "https://example.com/p", doi: "10.1/x", arxivId: "2301.1" }),
    "https://example.com/p",
  );
  assert.equal(
    resolveRelatedPaperUrl({ doi: "10.1145/3592979" }),
    "https://doi.org/10.1145/3592979",
  );
  assert.equal(
    resolveRelatedPaperUrl({ arxivId: "2305.12345" }),
    "https://arxiv.org/abs/2305.12345",
  );
  assert.equal(resolveRelatedPaperUrl({}), undefined);
});
