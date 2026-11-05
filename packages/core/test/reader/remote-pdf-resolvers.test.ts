import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubRepoPdfResolver } from "../../src/reader/github-repo-pdf-resolver.js";
import { StoredPdfResolver } from "../../src/reader/stored-pdf-resolver.js";
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

test("StoredPdfResolver returns the signed URL for the paper id", async () => {
  const seen: string[] = [];
  const stored = new StoredPdfResolver({
    signedUrl: async (id) => {
      seen.push(id);
      return id === "p" ? "https://files.example/p.pdf?sig=1" : null;
    },
  });
  assert.deepEqual(await stored.resolve({ id: "p" }), { url: "https://files.example/p.pdf?sig=1" });
  assert.equal(await stored.resolve({ id: "q" }), null);
  assert.deepEqual(seen, ["p", "q"]);
});

test("ladder order: cache, open access, GitHub repo, then our storage", async () => {
  const miss = (id: string): IPdfSourceResolver => ({ id, supports: () => true, resolve: async () => null });
  const calls: string[] = [];
  const github = new GitHubRepoPdfResolver({
    buildFileUrl: (path) => {
      calls.push("github");
      return path.endsWith("hit.pdf") ? `gh://${path}` : null;
    },
  });
  const stored = new StoredPdfResolver({
    signedUrl: async () => {
      calls.push("stored");
      return "https://files.example/x.pdf";
    },
  });
  const ladder = [miss("browser-cache"), miss("open-access"), github, stored];

  const fromRepo = await resolvePdfSource({ id: "hit" }, ladder);
  assert.equal(fromRepo.ok && fromRepo.resolverId, "github-repo");
  assert.deepEqual(calls, ["github"]);

  const fromStore = await resolvePdfSource({ id: "other" }, ladder);
  assert.equal(fromStore.ok && fromStore.resolverId, "server-blob");
  assert.deepEqual(calls, ["github", "github", "stored"]);
});

test("a throwing storage step is a miss, not a crash", async () => {
  const stored = new StoredPdfResolver({
    signedUrl: async () => {
      throw new Error("store down");
    },
  });
  assert.deepEqual(await resolvePdfSource({ id: "p" }, [stored]), { ok: false, reason: "no_source" });
});
