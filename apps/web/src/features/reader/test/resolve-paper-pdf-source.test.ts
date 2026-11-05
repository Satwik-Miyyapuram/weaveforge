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

test("resolvePaperPdfSource prefers open access over the GitHub repo and our storage", async () => {
  const calls: string[] = [];
  const hit = await resolvePaperPdfSource({ id: "p1", arxivId: "2301.00001" }, undefined, {
    githubFileUrl: (path) => (calls.push("github"), `https://gh.example/${path}`),
    storedPdfUrl: async () => (calls.push("stored"), "https://files.example/p1.pdf"),
  });
  assert.equal(hit.ok && hit.resolverId, "open-access");
  assert.deepEqual(calls, []);
});

test("resolvePaperPdfSource tries the GitHub repo before our storage", async () => {
  const hit = await resolvePaperPdfSource({ id: "p1" }, undefined, {
    githubFileUrl: (path) => `https://gh.example/${path}`,
    storedPdfUrl: async () => "https://files.example/p1.pdf",
  });
  assert.equal(hit.ok && hit.resolverId, "github-repo");
  assert.equal(hit.ok && hit.hit.url, "https://gh.example/papers/pdf/p1.pdf");
});

test("resolvePaperPdfSource falls back to our storage last", async () => {
  const hit = await resolvePaperPdfSource({ id: "p1" }, undefined, {
    githubFileUrl: () => null,
    storedPdfUrl: async () => "https://files.example/p1.pdf",
  });
  assert.equal(hit.ok && hit.resolverId, "server-blob");
});

test("resolvePaperPdfSource skips WebDAV until a sealed proxy exists", async () => {
  const hit = await resolvePaperPdfSource({
    id: "p1",
    metadata: { webdavPath: "/library/paper.pdf" },
  });
  assert.equal(hit.ok, false);
});
