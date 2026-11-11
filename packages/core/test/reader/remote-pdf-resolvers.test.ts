import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubRepoPdfResolver } from "../../src/reader/parts.js";
import { resolvePdfSource, type IPdfSourceResolver } from "../../src/reader/pdf-source-ladder.js";

const echo = new GitHubRepoPdfResolver({ buildFileUrl: (path) => `gh://${path}` });

test("GitHubRepoPdfResolver uses the workspace layout path by default", async () => {
  assert.deepEqual(await echo.resolve({ id: "abc-123" }), { url: "gh://papers/pdf/abc-123.pdf" });
});

test("GitHubRepoPdfResolver prefers a relative pdfPath from metadata", async () => {
  const hit = await echo.resolve({ id: "p", metadata: { pdfPath: "papers/pdf/other.pdf" } });
  assert.deepEqual(hit, { url: "gh://papers/pdf/other.pdf" });
});

test("GitHubRepoPdfResolver ignores unsafe pdfPath values and falls back to the layout path", async () => {
  for (const pdfPath of ["/etc/x.pdf", "../x.pdf", "papers/../../x.pdf", "C:\\x.pdf", "https://e.com/x.pdf", ""]) {
    const hit = await echo.resolve({ id: "p1", metadata: { pdfPath } });
    assert.deepEqual(hit, { url: "gh://papers/pdf/p1.pdf" }, pdfPath);
  }
});

test("GitHubRepoPdfResolver refuses ids that are not safe file names", async () => {
  assert.equal(await echo.resolve({ id: "../x" }), null);
  assert.equal(await echo.resolve({ id: "a/b" }), null);
  assert.equal(await echo.resolve({ id: "" }), null);
});

test("GitHubRepoPdfResolver misses when no repo is configured", async () => {
  const none = new GitHubRepoPdfResolver({ buildFileUrl: () => null });
  assert.equal(await none.resolve({ id: "p" }), null);
});

test("ladder order: cache, open access, then GitHub repo", async () => {
  const miss = (id: string): IPdfSourceResolver => ({ id, supports: () => true, resolve: async () => null });
  const calls: string[] = [];
  const github = new GitHubRepoPdfResolver({
    buildFileUrl: (path) => {
      calls.push("github");
      return path.endsWith("hit.pdf") ? `gh://${path}` : null;
    },
  });
  const ladder = [miss("browser-cache"), miss("open-access"), github];

  const fromRepo = await resolvePdfSource({ id: "hit" }, ladder);
  assert.equal(fromRepo.ok && fromRepo.resolverId, "github-repo");
  assert.deepEqual(calls, ["github"]);

  assert.deepEqual(await resolvePdfSource({ id: "other" }, ladder), { ok: false, reason: "no_source" });
});

test("PDFs are never read from our storage: no such ladder step exists", async () => {
  const reader = await import("../../src/index.js");
  assert.equal("StoredPdfResolver" in reader, false);
});
