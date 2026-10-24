import assert from "node:assert/strict";
import test from "node:test";
import type { PaperSummary } from "@weaveforge/core";
import { fetchRelatedPapers, resolveRelatedPaperUrl } from "../application/fetch-related-papers";

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

/** 25-17: the same paper from both sources, or twice from one, is listed once. */
async function withS2(recommended: unknown[], references: unknown[], run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const body = url.includes("recommendations")
      ? { recommendedPapers: recommended }
      : { data: references.map((citedPaper) => ({ citedPaper })) };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

const seed = { id: "s", title: "Seed", doi: "10.1/seed" } as PaperSummary;

test("fetchRelatedPapers lists a paper found by both sources once (25-17)", async () => {
  await withS2(
    [
      { title: "A", externalIds: { DOI: "10.1/A" } },
      { title: "B", externalIds: { ArXiv: "2401.0001" } },
    ],
    [
      { title: "A (ref copy)", externalIds: { DOI: "10.1/a" } },
      { title: "b", externalIds: { ArXiv: "2401.0001" } },
      { title: "C" },
      { title: "c" },
    ],
    async () => {
      const hits = await fetchRelatedPapers(seed, [], { limit: 10 });
      assert.deepEqual(hits.map((h) => h.title), ["A", "B", "C"]);
    },
  );
});

test("fetchRelatedPapers dedupes within one source and still skips the library", async () => {
  await withS2(
    [
      { title: "X", externalIds: { DOI: "10.1/x" } },
      { title: "X again", externalIds: { DOI: "10.1/X" } },
      { title: "Mine", externalIds: { DOI: "10.1/mine" } },
    ],
    [],
    async () => {
      const library = [{ id: "m", title: "Mine", doi: "10.1/mine" } as PaperSummary];
      const hits = await fetchRelatedPapers(seed, library, { limit: 10 });
      assert.deepEqual(hits.map((h) => h.title), ["X"]);
    },
  );
});
