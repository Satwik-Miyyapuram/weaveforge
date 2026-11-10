import assert from "node:assert/strict";
import test from "node:test";
import type { PdfLocus } from "@weaveforge/wasm";
import { readyCore, typedCore } from "@/lib/rust-core";

const locus: PdfLocus = {
  quote: { type: "TextQuoteSelector", exact: "the used sentence" },
};

test("buildLocusLink encodes paper, pdf, page, and a round-trippable locus", () => {
  const link = readyCore().buildLocusLink({
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
  assert.deepEqual(typedCore().decodeLocus(url.searchParams.get("locus")), locus);
});

test("buildLocusLink omits absent and invalid parts", () => {
  assert.equal(readyCore().buildLocusLink({}), "/reader");
  const link = readyCore().buildLocusLink({ paperId: "p1", page: -1 });
  const url = new URL(link, "https://app.test");
  assert.equal(url.searchParams.get("page"), null);
  assert.equal(url.searchParams.get("locus"), null);
});

test("buildLocusLink drops javascript and other unsafe pdf URLs", () => {
  const link = readyCore().buildLocusLink({
    paperId: "p1",
    pdfUrl: "javascript:alert(1)",
  });
  const url = new URL(link, "https://app.test");
  assert.equal(url.searchParams.get("paper"), "p1");
  assert.equal(url.searchParams.get("pdf"), null);
});

