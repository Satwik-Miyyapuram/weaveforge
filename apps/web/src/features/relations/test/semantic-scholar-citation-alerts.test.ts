import { test } from "node:test";
import assert from "node:assert/strict";
import { SemanticScholarCitationSource } from "../infrastructure/semantic-scholar-citation-source";

test("Semantic Scholar incoming citations page and map stable candidates", async () => {
  const urls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const second = url.includes("offset=1");
    return new Response(
      JSON.stringify(
        second
          ? {
              data: [
                {
                  citingPaper: {
                    paperId: "s2-2",
                    title: "Second",
                    authors: [{ name: "B. Author" }],
                    year: 2026,
                    url: null,
                  },
                },
              ],
            }
          : {
              data: [
                {
                  citingPaper: {
                    paperId: "s2-1",
                    title: "First",
                    authors: [{ name: "A. Author" }],
                    year: 2025,
                    url: "https://example.test/first",
                  },
                },
              ],
              next: 1,
            },
      ),
      { status: 200 },
    );
  }) as typeof fetch;
  const source = new SemanticScholarCitationSource(fetchFn, "https://s2.test");

  const result = await source.citations({ kind: "doi", value: "10.1000/example" });

  assert.deepEqual(
    result.map(({ id, title, authors, year }) => ({ id, title, authors, year })),
    [
      { id: "s2-1", title: "First", authors: ["A. Author"], year: 2025 },
      { id: "s2-2", title: "Second", authors: ["B. Author"], year: 2026 },
    ],
  );
  assert.match(result[1]!.url!, /s2-2$/);
  assert.equal(urls.length, 2);
  assert.match(urls[0]!, /DOI%3A10.1000%2Fexample/);
  assert.match(urls[0]!, /contexts/);
  assert.match(urls[0]!, /intents/);
  assert.match(urls[0]!, /isInfluential/);
  assert.equal(result[0]!.contexts, undefined);
  assert.equal(result[0]!.intents, undefined);
  assert.equal(result[0]!.isInfluential, undefined);
});

test("Semantic Scholar maps contexts, intents, and isInfluential when present", async () => {
  const fetchFn = (async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            contexts: ["We build on the latent-space analysis of Prior."],
            intents: ["method", "result"],
            isInfluential: true,
            citingPaper: {
              paperId: "s2-rich",
              title: "Rich",
              authors: [{ name: "C. Author" }],
              year: 2026,
              url: "https://example.test/rich",
              citationCount: 12,
            },
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;
  const source = new SemanticScholarCitationSource(fetchFn, "https://s2.test");

  const [candidate] = await source.citations({ kind: "arxiv", value: "2401.00001" });
  assert.deepEqual(candidate, {
    id: "s2-rich",
    title: "Rich",
    authors: ["C. Author"],
    year: 2026,
    url: "https://example.test/rich",
    citationCount: 12,
    contexts: ["We build on the latent-space analysis of Prior."],
    intents: ["method", "result"],
    isInfluential: true,
  });
});

test("Semantic Scholar keeps intents when contexts are absent", async () => {
  const fetchFn = (async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            intents: ["background"],
            isInfluential: false,
            citingPaper: {
              paperId: "s2-intent-only",
              title: "Intent only",
              authors: [],
              year: 2024,
            },
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;
  const source = new SemanticScholarCitationSource(fetchFn, "https://s2.test");

  const [candidate] = await source.citations({ kind: "doi", value: "10.1000/intent" });
  assert.equal(candidate!.contexts, undefined);
  assert.deepEqual(candidate!.intents, ["background"]);
  assert.equal(candidate!.isInfluential, false);
});

test("Semantic Scholar ignores malformed citation-edge signal fields", async () => {
  const fetchFn = (async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            contexts: "not-an-array",
            intents: ["method", "nope", 3, "result"],
            isInfluential: "yes",
            citingPaper: {
              paperId: "s2-malformed",
              title: "Malformed",
              authors: [{ name: "D. Author" }],
            },
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;
  const source = new SemanticScholarCitationSource(fetchFn, "https://s2.test");

  const [candidate] = await source.citations({ kind: "doi", value: "10.1000/bad" });
  assert.equal(candidate!.contexts, undefined);
  assert.deepEqual(candidate!.intents, ["method", "result"]);
  assert.equal(candidate!.isInfluential, undefined);
});
