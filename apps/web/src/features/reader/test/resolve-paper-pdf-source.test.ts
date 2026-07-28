import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paperToPdfSourcePaper,
  resolvePaperPdfSource,
} from "../application/resolve-paper-pdf-source.js";

test("paperToPdfSourcePaper maps domain fields onto the ladder shape", () => {
  const paper = paperToPdfSourcePaper({
    id: "p1",
    url: "https://arxiv.org/abs/2301.00001",
    arxivId: "2301.00001",
    doi: "10.1/x",
    pdfPath: "ignored-for-now",
  });
  assert.equal(paper.id, "p1");
  assert.equal(paper.arxivId, "2301.00001");
  assert.equal(paper.metadata?.["pdfPath"], "ignored-for-now");
});

test("resolvePaperPdfSource uses the open-access ladder step", async () => {
  const hit = await resolvePaperPdfSource({
    id: "p1",
    arxivId: "2301.00001",
  });
  assert.equal(hit.ok, true);
  if (hit.ok) {
    assert.equal(hit.resolverId, "open-access");
    assert.match(hit.hit.url, /arxiv\.org\/pdf\/2301\.00001/);
  }
});

test("resolvePaperPdfSource fails closed when nothing looks like a PDF", async () => {
  const miss = await resolvePaperPdfSource({
    id: "p1",
    url: "https://example.com/landing.html",
  });
  assert.equal(miss.ok, false);
});

test("resolvePaperPdfSource skips WebDAV until a sealed proxy exists", async () => {
  const hit = await resolvePaperPdfSource({
    id: "p1",
    metadata: { webdavPath: "/library/paper.pdf" },
  });
  assert.equal(hit.ok, false);
});
