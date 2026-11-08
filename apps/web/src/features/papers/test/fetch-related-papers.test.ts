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

/** Answers each request from the first route whose key is in the URL; 404 otherwise. */
async function withRoutes(routes: [string, unknown][], run: (urls: string[]) => Promise<void>) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = decodeURIComponent(String(input));
    urls.push(url);
    const hit = routes.find(([key]) => url.includes(key));
    return hit ? new Response(JSON.stringify(hit[1]), { status: 200 }) : new Response("{}", { status: 404 });
  }) as typeof fetch;
  try {
    await run(urls);
  } finally {
    globalThis.fetch = original;
  }
}

test("cited-by lists the papers citing the seed, most cited first, skipping the library", async () => {
  const citing = [
    { title: "Small", citationCount: 2 },
    { title: "Mine", externalIds: { DOI: "10.1/mine" }, citationCount: 50 },
    { title: "Big", citationCount: 90 },
  ];
  await withRoutes([["/citations", { data: citing.map((citingPaper) => ({ citingPaper })) }]], async (urls) => {
    const library = [{ id: "m", title: "Mine", doi: "10.1/mine" } as PaperSummary];
    const hits = await fetchRelatedPapers(seed, library, { kind: "citedBy" });
    assert.deepEqual(hits.map((h) => h.title), ["Big", "Small"]);
    assert.ok(urls.every((u) => !u.includes("openalex")));
  });
});

const openAlexSeed = { id: "https://openalex.org/W1", related_works: ["https://openalex.org/W7", "https://openalex.org/W8"] };
const openAlexWork = {
  id: "https://openalex.org/W7",
  title: "From OpenAlex",
  doi: "https://doi.org/10.9/oa",
  publication_year: 2024,
  authorships: [{ author: { display_name: "Ada L" } }],
  cited_by_count: 12,
  abstract_inverted_index: { world: [1], Hello: [0] },
};

test("related falls back to OpenAlex when Semantic Scholar finds nothing", async () => {
  await withRoutes(
    [
      ["works/doi:10.1/seed", openAlexSeed],
      ["openalex_id:W7|W8", { results: [openAlexWork] }],
    ],
    async () => {
      const hits = await fetchRelatedPapers(seed, [], {});
      assert.deepEqual(hits, [
        {
          title: "From OpenAlex",
          authors: ["Ada L"],
          year: 2024,
          doi: "10.9/oa",
          arxivId: undefined,
          url: "https://doi.org/10.9/oa",
          abstract: "Hello world",
          citationCount: 12,
        },
      ]);
    },
  );
});

test("cited-by falls back to OpenAlex works that cite the seed, found by its arXiv DOI", async () => {
  const arxivSeed = { id: "s", title: "Seed", arxivId: "2401.00001v2" } as PaperSummary;
  await withRoutes(
    [
      ["works/doi:10.48550/arXiv.2401.00001", openAlexSeed],
      ["cites:W1", { results: [openAlexWork] }],
    ],
    async () => {
      const hits = await fetchRelatedPapers(arxivSeed, [], { kind: "citedBy" });
      assert.deepEqual(hits.map((h) => h.title), ["From OpenAlex"]);
    },
  );
});

test("an OpenAlex key is sent on every OpenAlex request, and only there", async () => {
  await withRoutes(
    [
      ["works/doi:10.1/seed", openAlexSeed],
      ["openalex_id:W7|W8", { results: [openAlexWork] }],
    ],
    async (urls) => {
      await fetchRelatedPapers(seed, [], { openAlexKey: "oa-key" });
      const openAlex = urls.filter((u) => u.includes("api.openalex.org"));
      assert.equal(openAlex.length, 2);
      assert.ok(openAlex.every((u) => u.includes("api_key=oa-key")));
      assert.ok(urls.filter((u) => !u.includes("api.openalex.org")).every((u) => !u.includes("oa-key")));
    },
  );
});

test("without an OpenAlex key no api_key is sent", async () => {
  await withRoutes(
    [
      ["works/doi:10.1/seed", openAlexSeed],
      ["openalex_id:W7|W8", { results: [openAlexWork] }],
    ],
    async (urls) => {
      await fetchRelatedPapers(seed, [], {});
      assert.ok(urls.every((u) => !u.includes("api_key")));
    },
  );
});

test("when both sources fail the Semantic Scholar error is reported", async () => {
  await withRoutes([], async () => {
    await assert.rejects(fetchRelatedPapers(seed, [], { kind: "citedBy" }), /Semantic Scholar request failed: 404/);
  });
});
