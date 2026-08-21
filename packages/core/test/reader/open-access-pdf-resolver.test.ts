import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAccessPdfResolver } from "../../src/reader/open-access-pdf-resolver.js";
import { resolvePdfSource } from "../../src/reader/pdf-source-ladder.js";

test("OpenAccessPdfResolver supports papers with arxiv, url, or doi", () => {
  const resolver = new OpenAccessPdfResolver({
    resolveUrl: () => "https://arxiv.org/pdf/1234.5678",
  });
  assert.equal(resolver.supports({ id: "p", arxivId: "1234.5678" }), true);
  assert.equal(resolver.supports({ id: "p", url: "https://example.com/a.pdf" }), true);
  assert.equal(resolver.supports({ id: "p", doi: "10.1/x" }), true);
  assert.equal(resolver.supports({ id: "p" }), false);
});

test("OpenAccessPdfResolver returns null when the injected mapper misses", async () => {
  const resolver = new OpenAccessPdfResolver({ resolveUrl: () => null });
  assert.equal(await resolver.resolve({ id: "p", arxivId: "1234.5678" }), null);
});

test("OpenAccessPdfResolver is used by the ladder as the first hit", async () => {
  const openAccess = new OpenAccessPdfResolver({
    resolveUrl: (paper) =>
      paper.arxivId ? `https://arxiv.org/pdf/${paper.arxivId}` : null,
  });
  const never = {
    id: "never",
    supports: () => true,
    resolve: async () => {
      throw new Error("should not run after a hit");
    },
  };
  const result = await resolvePdfSource(
    { id: "p", arxivId: "2301.00001" },
    [openAccess, never],
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.resolverId, "open-access");
    assert.equal(result.hit.url, "https://arxiv.org/pdf/2301.00001");
  }
});
