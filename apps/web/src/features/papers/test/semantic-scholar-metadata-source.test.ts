import { test } from "node:test";
import assert from "node:assert/strict";
import { SemanticScholarMetadataSource } from "../infrastructure/semantic-scholar-metadata-source";

interface Recorded {
  url: string;
  init?: RequestInit;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" }, statusText: ok ? "OK" : "ERR" });
}

const paper = {
  title: "Attention is all you need",
  authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
  year: 2017,
  venue: "NeurIPS",
  paperId: "abc123",
  externalIds: { DOI: "10.5555/3295222.3295349", ArXiv: "1706.03762" },
  openAccessPdf: { url: "https://arxiv.org/pdf/1706.03762" },
  citationCount: 90000,
};

function setup(body: unknown, ok = true, status = 200) {
  const calls: Recorded[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return jsonResponse(body, ok, status);
  }) as typeof fetch;
  const source = new SemanticScholarMetadataSource(fetchFn);
  return { calls, source };
}

test("supports DOI, arXiv and bibliographic refs", () => {
  const { source } = setup(paper);
  assert.equal(source.supports({ kind: "doi", value: "10.1/x" }), true);
  assert.equal(source.supports({ kind: "arxiv", value: "1706.03762" }), true);
  assert.equal(source.supports({ kind: "bibliographic", value: "t" }), true);
  assert.equal(source.supports({ kind: "url", value: "https://x" }), false);
});

test("a DOI resolves through the paper/DOI: endpoint and maps identifiers", async () => {
  const { calls, source } = setup(paper);
  const metadata = await source.fetch({ kind: "doi", value: "10.5555/3295222.3295349" });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /graph\/v1\/paper\/DOI:10\.5555%2F3295222\.3295349\?fields=/);
  assert.equal(metadata.title, "Attention is all you need");
  assert.equal(metadata.year, 2017);
  assert.equal(metadata.venue, "NeurIPS");
  assert.equal(metadata.doi, "10.5555/3295222.3295349");
  assert.equal(metadata.arxivId, "1706.03762");
  assert.equal(metadata.url, "https://www.semanticscholar.org/paper/abc123");
});

test("an arXiv id resolves through the paper/arXiv: endpoint", async () => {
  const { calls, source } = setup(paper);
  await source.fetch({ kind: "arxiv", value: "1706.03762" });
  assert.match(calls[0]!.url, /graph\/v1\/paper\/arXiv:1706\.03762\?fields=/);
});

test("a missing identifier paper fails so the resolver can fall through", async () => {
  const { source } = setup({}, false, 404);
  await assert.rejects(source.fetch({ kind: "doi", value: "10.1/unknown" }), /lookup failed: 404/);
});

test("bibliographic refs keep using the match endpoint with similarity gating", async () => {
  const { calls, source } = setup({ data: [paper] });
  const metadata = await source.fetch({
    kind: "bibliographic",
    value: "Attention is all you need",
    hints: { title: "Attention is all you need", year: 2017 },
  });
  assert.match(calls[0]!.url, /paper\/search\/match\?query=/);
  assert.equal(metadata.title, "Attention is all you need");
  await assert.rejects(
    new SemanticScholarMetadataSource((async () => jsonResponse({ data: [paper] })) as typeof fetch).fetch({
      kind: "bibliographic",
      value: "A completely different paper",
      hints: { title: "A completely different paper" },
    }),
    /No sufficiently similar/,
  );
});

test("a configured base URL wins, which is how the desktop relay is reached", async () => {
  const calls: Recorded[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return jsonResponse(paper);
  }) as typeof fetch;
  const source = new SemanticScholarMetadataSource(fetchFn, "/api/semantic-scholar/graph/v1", async () => "key-1");
  await source.fetch({ kind: "doi", value: "10.1/x" });
  assert.ok(calls[0]!.url.startsWith("/api/semantic-scholar/graph/v1/paper/DOI:"));
  assert.equal((calls[0]!.init?.headers as Record<string, string>)["x-api-key"], "key-1");
});
