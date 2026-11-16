import { test } from "node:test";
import assert from "node:assert/strict";
import {
  githubRemotePdfSources,
  paperToPdfSourcePaper,
  resolvePaperPdfSource,
} from "../application/parts-3.js";

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

test("resolvePaperPdfSource prefers open access over the GitHub repo", async () => {
  const calls: string[] = [];
  const hit = await resolvePaperPdfSource({ id: "p1", arxivId: "2301.00001" }, undefined, {
    githubFileUrl: (path) => (calls.push("github"), `https://gh.example/${path}`),
  });
  assert.equal(hit.ok && hit.resolverId, "open-access");
  assert.deepEqual(calls, []);
});

test("resolvePaperPdfSource falls back to the GitHub repo", async () => {
  const hit = await resolvePaperPdfSource({ id: "p1" }, undefined, {
    githubFileUrl: (path) => `https://gh.example/${path}`,
  });
  assert.equal(hit.ok && hit.resolverId, "github-repo");
  assert.equal(hit.ok && hit.hit.url, "https://gh.example/papers/pdf/p1.pdf");
});

test("resolvePaperPdfSource never reads a PDF from our storage", async () => {
  // An unknown source option is ignored: there is no our-storage step to feed.
  const remote = { githubFileUrl: () => null, storedPdfUrl: async () => "https://files.example/p1.pdf" };
  const hit = await resolvePaperPdfSource({ id: "p1" }, undefined, remote as never);
  assert.equal(hit.ok, false);
});

test("resolvePaperPdfSource skips WebDAV until a sealed proxy exists", async () => {
  const hit = await resolvePaperPdfSource({
    id: "p1",
    metadata: { webdavPath: "/library/paper.pdf" },
  });
  assert.equal(hit.ok, false);
});

const answer = (status: number) => (async () => new Response(null, { status })) as unknown as typeof fetch;

test("githubRemotePdfSources is empty outside the desktop shell", async () => {
  let asked = false;
  const fetchFn = (async () => ((asked = true), new Response(null, { status: 204 }))) as unknown as typeof fetch;
  assert.deepEqual(await githubRemotePdfSources({ isDesktop: false, fetchFn, now: () => 0 }), {});
  assert.equal(asked, false);
});

test("githubRemotePdfSources points at the shell route when a GitHub remote is set", async () => {
  const remote = await githubRemotePdfSources({ isDesktop: true, fetchFn: answer(204), now: () => 1e9 });
  assert.equal(remote.githubFileUrl?.("papers/pdf/a b.pdf"), "/api/github-file?path=papers%2Fpdf%2Fa%20b.pdf");
});

test("githubRemotePdfSources is empty when the shell has no GitHub remote", async () => {
  assert.deepEqual(await githubRemotePdfSources({ isDesktop: true, fetchFn: answer(404), now: () => 2e9 }), {});
});

test("githubRemotePdfSources is empty when the probe throws", async () => {
  const fetchFn = (async () => {
    throw new Error("down");
  }) as unknown as typeof fetch;
  assert.deepEqual(await githubRemotePdfSources({ isDesktop: true, fetchFn, now: () => 3e9 }), {});
});

test("githubRemotePdfSources asks the shell once a minute", async () => {
  let calls = 0;
  const fetchFn = (async () => (calls++, new Response(null, { status: 204 }))) as unknown as typeof fetch;
  await githubRemotePdfSources({ isDesktop: true, fetchFn, now: () => 4e9 });
  await githubRemotePdfSources({ isDesktop: true, fetchFn, now: () => 4e9 + 30_000 });
  assert.equal(calls, 1);
  await githubRemotePdfSources({ isDesktop: true, fetchFn, now: () => 4e9 + 61_000 });
  assert.equal(calls, 2);
});