import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanArxivId,
  cleanPmcid,
  findOpenAccessCopies,
  openAccessUrl,
  parseBiorxiv,
  parseDoaj,
  parseEuropePmc,
  parseHal,
  parseOpenAlex,
  parseSemanticScholar,
  parseUnpaywall,
  parseZenodo,
  rankOpenAccessCandidates,
  type OpenAccessHttp,
} from "../../../src/features/papers/index.js";

test("openAccessUrl keeps https, upgrades http, refuses the rest", () => {
  assert.equal(openAccessUrl("https://a.org/x.pdf"), "https://a.org/x.pdf");
  assert.equal(openAccessUrl("http://a.org/x.pdf"), "https://a.org/x.pdf");
  assert.equal(openAccessUrl("javascript:alert(1)"), undefined);
  assert.equal(openAccessUrl("https://user:pw@a.org/x.pdf"), undefined);
  assert.equal(openAccessUrl("not a url"), undefined);
  assert.equal(openAccessUrl(42), undefined);
});

test("identifier cleaning", () => {
  assert.equal(cleanArxivId("arXiv:2101.00001v2"), "2101.00001v2");
  assert.equal(cleanArxivId("hep-th/9901001"), "hep-th/9901001");
  assert.equal(cleanArxivId("../../etc"), undefined);
  assert.equal(cleanPmcid("pmc12345"), "PMC12345");
  assert.equal(cleanPmcid("12345"), "PMC12345");
  assert.equal(cleanPmcid("PMCX"), undefined);
});

test("OpenAlex: best location first, closed locations skipped, landing pages only when open", () => {
  const found = parseOpenAlex({
    best_oa_location: { is_oa: true, pdf_url: "https://repo.org/a.pdf", landing_page_url: "https://repo.org/a", license: "cc-by", version: "acceptedVersion" },
    locations: [
      { is_oa: false, pdf_url: "https://paywall.com/a.pdf", landing_page_url: "https://paywall.com/a" },
      { is_oa: true, pdf_url: null, landing_page_url: "https://journal.org/a" },
    ],
  });
  assert.deepEqual(found.map((c) => [c.format, c.url]), [
    ["pdf", "https://repo.org/a.pdf"],
    ["html", "https://repo.org/a"],
    ["html", "https://journal.org/a"],
  ]);
  assert.equal(found[0]!.license, "cc-by");
  assert.equal(found[0]!.version, "acceptedVersion");
  assert.deepEqual(parseOpenAlex(null), []);
  assert.deepEqual(parseOpenAlex({ locations: "nope" }), []);
});

test("Unpaywall, Semantic Scholar", () => {
  const u = parseUnpaywall({
    best_oa_location: { url_for_pdf: "https://x.org/p.pdf", url_for_landing_page: "https://x.org/p", license: "cc0" },
    oa_locations: [{ url_for_pdf: null, url_for_landing_page: "https://y.org/p" }],
  });
  assert.deepEqual(u.map((c) => c.url), ["https://x.org/p.pdf", "https://x.org/p", "https://y.org/p"]);
  assert.deepEqual(parseSemanticScholar({ openAccessPdf: { url: "https://s.org/p.pdf", license: "CCBY" } }), [
    { url: "https://s.org/p.pdf", format: "pdf", source: "semantic-scholar", license: "CCBY" },
  ]);
  assert.deepEqual(parseSemanticScholar({ openAccessPdf: null }), []);
});

test("Europe PMC: only free full texts, and the PMC copies when open access", () => {
  const { candidates, pmcid } = parseEuropePmc({
    resultList: {
      result: [
        {
          pmcid: "PMC777",
          isOpenAccess: "Y",
          license: "cc by",
          fullTextUrlList: {
            fullTextUrl: [
              { availabilityCode: "S", documentStyle: "pdf", url: "https://publisher.com/paywalled.pdf" },
              { availabilityCode: "OA", documentStyle: "pdf", url: "https://europepmc.org/articles/PMC777?pdf=render" },
              { availabilityCode: "F", documentStyle: "html", url: "https://pub.org/free" },
              { availabilityCode: "OA", documentStyle: "doi", url: "https://doi.org/10.1/x" },
            ],
          },
        },
      ],
    },
  });
  assert.equal(pmcid, "PMC777");
  assert.deepEqual(candidates.map((c) => [c.format, c.url]), [
    ["pdf", "https://europepmc.org/articles/PMC777?pdf=render"],
    ["html", "https://pub.org/free"],
    ["pdf", "https://europepmc.org/articles/PMC777?pdf=render"],
    ["html", "https://pmc.ncbi.nlm.nih.gov/articles/PMC777/"],
  ]);
  assert.deepEqual(parseEuropePmc({ resultList: { result: [] } }), { candidates: [] });
});

test("bioRxiv: the newest version's PDF and full-text page", () => {
  const found = parseBiorxiv(
    { collection: [{ doi: "10.1101/2020.01.01.111", version: "1" }, { doi: "10.1101/2020.01.01.111", version: "3", license: "cc_by" }] },
    "biorxiv",
  );
  assert.deepEqual(found.map((c) => c.url), [
    "https://www.biorxiv.org/content/10.1101/2020.01.01.111v3.full.pdf",
    "https://www.biorxiv.org/content/10.1101/2020.01.01.111v3.full",
  ]);
  assert.equal(found[0]!.version, "v3");
  assert.deepEqual(parseBiorxiv({ collection: [] }, "biorxiv"), []);
  assert.deepEqual(parseBiorxiv({ collection: [{ doi: "x", version: "1; drop" }] }, "biorxiv"), []);
});

test("DOAJ, Zenodo, HAL", () => {
  assert.deepEqual(
    parseDoaj({
      results: [
        {
          bibjson: {
            journal: { license: [{ type: "CC BY" }] },
            link: [
              { type: "fulltext", content_type: "PDF", url: "https://j.org/a.pdf" },
              { type: "fulltext", url: "https://j.org/a" },
              { type: "homepage", url: "https://j.org" },
            ],
          },
        },
      ],
    }).map((c) => [c.format, c.url, c.license]),
    [
      ["pdf", "https://j.org/a.pdf", "CC BY"],
      ["html", "https://j.org/a", "CC BY"],
    ],
  );
  assert.deepEqual(
    parseZenodo({
      metadata: { access_right: "open", license: { id: "cc-by-4.0" } },
      files: [
        { key: "data.csv", links: { self: "https://zenodo.org/api/records/1/files/data.csv/content" } },
        { key: "paper.pdf", links: { self: "https://zenodo.org/api/records/1/files/paper.pdf/content" } },
      ],
    }).map((c) => c.url),
    ["https://zenodo.org/api/records/1/files/paper.pdf/content"],
  );
  assert.deepEqual(parseZenodo({ metadata: { access_right: "embargoed" }, files: [{ key: "p.pdf", links: { self: "https://z.org/p.pdf" } }] }), []);
  assert.deepEqual(
    parseHal({ response: { docs: [{ fileMain_s: "https://hal.science/hal-1/document", linkExtUrl_s: "https://arxiv.org/pdf/2101.00001" }] } }).map((c) => [c.format, c.url]),
    [
      ["pdf", "https://hal.science/hal-1/document"],
      ["pdf", "https://arxiv.org/pdf/2101.00001"],
    ],
  );
});

test("ranking: deduplicated, PDFs before pages, source order within each", () => {
  const ranked = rankOpenAccessCandidates([
    { url: "https://b.org/p", format: "html", source: "arxiv" },
    { url: "https://c.org/p.pdf", format: "pdf", source: "hal" },
    { url: "https://a.org/p.pdf", format: "pdf", source: "openalex", license: "first" },
    { url: "https://a.org/p.pdf#page=2", format: "pdf", source: "arxiv", license: "second" },
  ]);
  assert.deepEqual(ranked.map((c) => c.url), ["https://a.org/p.pdf", "https://c.org/p.pdf", "https://b.org/p"]);
  assert.equal(ranked[0]!.license, "first");
});

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
