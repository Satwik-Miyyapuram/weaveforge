import { test } from "node:test";
import assert from "node:assert/strict";
import { rankCitationAlerts, type CitationCandidate } from "@thesis/core";
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

test("Semantic Scholar skips whitespace-only titles", async () => {
  const fetchFn = (async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            citingPaper: {
              paperId: "s2-blank",
              title: "   ",
              authors: [],
            },
          },
          {
            citingPaper: {
              paperId: "s2-ok",
              title: "  Real Title  ",
              authors: [],
            },
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;
  const source = new SemanticScholarCitationSource(fetchFn, "https://s2.test");
  const result = await source.citations({ kind: "doi", value: "10.1000/blank" });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, "s2-ok");
  assert.equal(result[0]!.title, "Real Title");
});

test("Semantic Scholar stops paging when next does not advance", async () => {
  let fetches = 0;
  const fetchFn = (async () => {
    fetches += 1;
    return new Response(
      JSON.stringify({
        data: [
          {
            citingPaper: {
              paperId: "s2-stuck",
              title: "Stuck",
              authors: [],
            },
          },
        ],
        next: 0,
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const source = new SemanticScholarCitationSource(fetchFn, "https://s2.test");
  const result = await source.citations({ kind: "doi", value: "10.1000/stuck" });
  assert.equal(result.length, 1);
  assert.equal(fetches, 1);
});

test("Semantic Scholar soft-stops before the API offset ceiling", async () => {
  let fetches = 0;
  const fetchFn = (async (_input: RequestInfo | URL) => {
    fetches += 1;
    const url = String(_input);
    if (url.includes("offset=10000")) {
      return new Response("bad offset", { status: 400 });
    }
    return new Response(
      JSON.stringify({
        data: [
          {
            citingPaper: {
              paperId: `s2-${fetches}`,
              title: `Paper ${fetches}`,
              authors: [],
            },
          },
        ],
        next: 10_000,
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const source = new SemanticScholarCitationSource(fetchFn, "https://s2.test");
  const result = await source.citations({ kind: "doi", value: "10.1000/hot" });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, "s2-1");
  assert.equal(fetches, 1);
});

function candidate(
  partial: Pick<CitationCandidate, "id" | "title"> & Partial<CitationCandidate>,
): CitationCandidate {
  return {
    authors: [],
    ...partial,
  };
}

test("rankCitationAlerts orders result and method above background", () => {
  const ranked = rankCitationAlerts([
    candidate({ id: "bg", title: "Background", year: 2026, intents: ["background"] }),
    candidate({ id: "res", title: "Result", year: 2020, intents: ["result"] }),
    candidate({ id: "meth", title: "Method", year: 2020, intents: ["method"] }),
  ]);
  assert.deepEqual(
    ranked.map((c) => c.id),
    ["res", "meth", "bg"],
  );
});

test("rankCitationAlerts promotes isInfluential strongly", () => {
  const ranked = rankCitationAlerts([
    candidate({ id: "bg", title: "Bg", year: 2026, intents: ["background"] }),
    candidate({
      id: "inf",
      title: "Influential background",
      year: 2018,
      intents: ["background"],
      isInfluential: true,
    }),
  ]);
  assert.equal(ranked[0]!.id, "inf");
});

test("rankCitationAlerts falls back to recency when all signals are absent", () => {
  const ranked = rankCitationAlerts([
    candidate({ id: "old", title: "Old", year: 2010 }),
    candidate({ id: "new", title: "New", year: 2024 }),
    candidate({ id: "mid", title: "Mid", year: 2018 }),
  ]);
  assert.deepEqual(
    ranked.map((c) => c.id),
    ["new", "mid", "old"],
  );
});

test("rankCitationAlerts mixes signalled and unsignalled items without sinking the latter", () => {
  const ranked = rankCitationAlerts([
    candidate({ id: "plain-new", title: "Plain new", year: 2025 }),
    candidate({ id: "bg-old", title: "Bg old", year: 2015, intents: ["background"] }),
    candidate({ id: "method", title: "Method", year: 2016, intents: ["method"] }),
    candidate({ id: "plain-old", title: "Plain old", year: 2010 }),
  ]);
  // method beats plain-new (intent outweighs a few years); plain-new still
  // beats background-old and is not sorted last merely for lacking signals.
  assert.equal(ranked[0]!.id, "method");
  assert.equal(ranked[1]!.id, "plain-new");
  assert.ok(ranked.findIndex((c) => c.id === "plain-old") > ranked.findIndex((c) => c.id === "plain-new"));
});

test("rankCitationAlerts uses the strongest intent and does not mutate input", () => {
  const input = [
    candidate({
      id: "multi",
      title: "Multi",
      year: 2020,
      intents: ["background", "result"],
    }),
    candidate({
      id: "method",
      title: "Method",
      year: 2020,
      intents: ["method"],
    }),
  ];
  const originalOrder = input.map((item) => item.id);
  const ranked = rankCitationAlerts(input);
  assert.deepEqual(ranked.map((item) => item.id), ["multi", "method"]);
  assert.deepEqual(input.map((item) => item.id), originalOrder);
});

test("rankCitationAlerts resolves score ties by title", () => {
  const ranked = rankCitationAlerts([
    candidate({ id: "z", title: "Zebra", year: 2020 }),
    candidate({ id: "a", title: "Alpha", year: 2020 }),
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ["a", "z"]);
});

test("rankCitationAlerts resolves equal title ties by id", () => {
  const ranked = rankCitationAlerts([
    candidate({ id: "z", title: "Same", year: 2020 }),
    candidate({ id: "a", title: "Same", year: 2020 }),
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ["a", "z"]);
});
