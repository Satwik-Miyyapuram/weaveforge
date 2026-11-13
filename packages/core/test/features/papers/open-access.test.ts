import { test } from "node:test";
import assert from "node:assert/strict";
import { findOpenAccessCopies, type OpenAccessHttp } from "../../../src/index.js";

// The parsers, id cleaning and ranking are tested in Rust (crates/wf-core/src/papers/open_access.rs).

test("findOpenAccessCopies asks each index by the right id and merges the answers", async () => {
  const asked: string[] = [];
  const http: OpenAccessHttp = async (url) => {
    asked.push(url);
    if (url.startsWith("https://api.openalex.org/")) {
      return { best_oa_location: { is_oa: true, pdf_url: "https://repo.org/a.pdf" } };
    }
    if (url.startsWith("https://api.semanticscholar.org/")) throw new Error("429");
    return null;
  };
  const result = await findOpenAccessCopies(
    { doi: "https://doi.org/10.1234/ABC", arxivId: "2101.00001", knownPdfUrl: "https://mine.org/p.pdf" },
    { http },
  );
  assert.deepEqual(result.failed, ["semantic-scholar"]);
  assert.deepEqual(result.asked, ["openalex", "semantic-scholar", "europe-pmc", "doaj", "hal"]);
  assert.deepEqual(result.candidates.map((c) => [c.source, c.format]), [
    ["paper", "pdf"],
    ["arxiv", "pdf"],
    ["openalex", "pdf"],
    ["arxiv", "html"],
  ]);
  assert.ok(asked.some((u) => u === "https://api.openalex.org/works/doi:10.1234%2Fabc"));
  // No Unpaywall without a contact address; no bioRxiv, Zenodo or PMC for a DOI that is not theirs.
  assert.ok(!asked.some((u) => u.includes("unpaywall") || u.includes("biorxiv") || u.includes("zenodo")));
});

test("findOpenAccessCopies routes registrant DOIs and the arXiv DOI", async () => {
  const asked: string[] = [];
  const http: OpenAccessHttp = async (url) => {
    asked.push(url);
    return null;
  };
  await findOpenAccessCopies({ doi: "10.1101/2020.01.01.111" }, { http, unpaywallEmail: "me@example.org" });
  assert.ok(asked.includes("https://api.biorxiv.org/details/biorxiv/10.1101/2020.01.01.111"));
  assert.ok(asked.includes("https://api.biorxiv.org/details/medrxiv/10.1101/2020.01.01.111"));
  assert.ok(asked.some((u) => u.startsWith("https://api.unpaywall.org/v2/10.1101%2F2020.01.01.111?email=me%40example.org")));

  asked.length = 0;
  await findOpenAccessCopies({ doi: "10.5281/zenodo.42" }, { http, sources: ["zenodo"] });
  assert.deepEqual(asked, ["https://zenodo.org/api/records/42"]);

  const fromArxivDoi = await findOpenAccessCopies({ doi: "10.48550/arXiv.2101.00001" }, { http, sources: ["arxiv"] });
  assert.deepEqual(fromArxivDoi.candidates.map((c) => c.url), [
    "https://arxiv.org/pdf/2101.00001",
    "https://arxiv.org/html/2101.00001",
  ]);
});

test("findOpenAccessCopies sends an OpenAlex key to OpenAlex only", async () => {
  const asked: string[] = [];
  const http: OpenAccessHttp = async (url) => {
    asked.push(url);
    return null;
  };
  await findOpenAccessCopies({ doi: "10.1234/abc" }, { http, openAlexKey: " oa key " });
  assert.ok(asked.includes("https://api.openalex.org/works/doi:10.1234%2Fabc?api_key=oa%20key"));
  assert.equal(asked.filter((u) => u.includes("api_key")).length, 1);

  asked.length = 0;
  await findOpenAccessCopies({ doi: "10.1234/abc" }, { http, openAlexKey: "  " });
  assert.ok(asked.includes("https://api.openalex.org/works/doi:10.1234%2Fabc"));
});

test("findOpenAccessCopies with nothing to go on asks nobody", async () => {
  let calls = 0;
  const result = await findOpenAccessCopies({}, { http: async () => (calls++, null) });
  assert.equal(calls, 0);
  assert.deepEqual(result, { candidates: [], failed: [], asked: [] });
});

test("findOpenAccessCopies: a paper's own web page is the first page tried, and needs no index", async () => {
  const asked: string[] = [];
  const result = await findOpenAccessCopies(
    { pageUrl: "http://lilianweng.github.io/posts/2023-06-23-agent/" },
    {
      http: async (url) => {
        asked.push(url);
        return null;
      },
    },
  );
  assert.deepEqual(asked, [], "no identifier, so no index is asked");
  assert.deepEqual(result.candidates, [
    { url: "https://lilianweng.github.io/posts/2023-06-23-agent/", format: "html", source: "paper" },
  ]);
});
