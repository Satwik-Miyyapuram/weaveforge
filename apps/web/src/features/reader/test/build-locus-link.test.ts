import assert from "node:assert/strict";
import test from "node:test";
import { decodeLocus, type PdfLocus } from "@thesis/core";
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

test("locusLinkIsResolvable needs a paper or a pdf url", () => {
  assert.equal(locusLinkIsResolvable({ paperId: "p1" }), true);
  assert.equal(locusLinkIsResolvable({ pdfUrl: "https://x/y.pdf" }), true);
  assert.equal(locusLinkIsResolvable({}), false);
});
