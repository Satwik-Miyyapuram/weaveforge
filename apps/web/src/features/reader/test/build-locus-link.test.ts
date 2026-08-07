import assert from "node:assert/strict";
import test from "node:test";
import { decodeLocus, type PdfLocus } from "@weaveforge/core";
import { buildLocusLink, locusLinkIsResolvable } from "../application/build-locus-link.js";

const locus: PdfLocus = {
  quote: { type: "TextQuoteSelector", exact: "the used sentence" },
};

test("buildLocusLink encodes paper, pdf, page, and a round-trippable locus", () => {
  const link = buildLocusLink({
    paperId: "p1",
    pdfUrl: "https://arxiv.org/pdf/1706.03762",
    locus,
    page: 3,
  });
  const url = new URL(link, "https://app.test");
  assert.equal(url.pathname, "/reader");
  assert.equal(url.searchParams.get("paper"), "p1");
  assert.equal(url.searchParams.get("pdf"), "https://arxiv.org/pdf/1706.03762");
  assert.equal(url.searchParams.get("page"), "3");
  assert.deepEqual(decodeLocus(url.searchParams.get("locus")), locus);
});

test("buildLocusLink omits absent and invalid parts", () => {
  assert.equal(buildLocusLink({}), "/reader");
  const link = buildLocusLink({ paperId: "p1", page: -1 });
  const url = new URL(link, "https://app.test");
  assert.equal(url.searchParams.get("page"), null);
  assert.equal(url.searchParams.get("locus"), null);
});

test("buildLocusLink drops javascript and other unsafe pdf URLs", () => {
  const link = buildLocusLink({
    paperId: "p1",
    pdfUrl: "javascript:alert(1)",
  });
  const url = new URL(link, "https://app.test");
  assert.equal(url.searchParams.get("paper"), "p1");
  assert.equal(url.searchParams.get("pdf"), null);
});

test("locusLinkIsResolvable rejects unsafe pdf urls without a paper id", () => {
  assert.equal(locusLinkIsResolvable({ pdfUrl: "javascript:alert(1)" }), false);
});
