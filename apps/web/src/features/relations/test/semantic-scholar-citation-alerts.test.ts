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
});
