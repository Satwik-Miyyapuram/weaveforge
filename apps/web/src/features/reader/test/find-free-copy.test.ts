import assert from "node:assert/strict";
import test from "node:test";
import type { OpenAccessCandidate, OpenAccessLookup } from "@weaveforge/core";
import {
  describeFreeCopyFailure,
  findFreeCopy,
  isWebArticle,
  MAX_HTML_ATTEMPTS,
  MAX_PDF_ATTEMPTS,
  openAccessIdsOf,
  type FreeCopyDeps,
  type FreeCopyOutcome,
  type HtmlFetchResult,
  type PdfAttempt,
} from "../application/find-free-copy";
import type { PaperHtmlPage } from "../application/paper-html";

const pdf = (host: string): OpenAccessCandidate => ({ url: `https://${host}/p.pdf`, format: "pdf", source: "openalex" });
const html = (host: string): OpenAccessCandidate => ({ url: `https://${host}/p`, format: "html", source: "openalex" });
const LONG = "word ".repeat(1200);

type TestDeps = FreeCopyDeps & { tried: string[]; saved: PaperHtmlPage[] };

function deps(lookup: Partial<OpenAccessLookup>, over: (d: TestDeps) => Partial<FreeCopyDeps> = () => ({})): TestDeps {
  const d: TestDeps = {
    tried: [],
    saved: [],
    lookup: async () => ({ candidates: [], failed: [], asked: ["openalex"], ...lookup }),
    fetchPdf: async (_id, url): Promise<PdfAttempt> => {
      d.tried.push(url);
      return { ok: false, reason: "blocked" };
    },
    fetchHtml: async (url): Promise<HtmlFetchResult> => {
      d.tried.push(url);
      return { ok: true, raw: LONG, finalUrl: url };
    },
    sanitize: (raw) => ({ html: `<p>${raw}</p>`, text: raw, title: "T" }),
    saveHtml: async (page) => {
      d.saved.push(page);
    },
    now: () => new Date("2026-09-24T00:00:00Z"),
  };
  return Object.assign(d, over(d));
}

const none = (o: FreeCopyOutcome) => {
  assert.equal(o.kind, "none");
  return o as Extract<FreeCopyOutcome, { kind: "none" }>;
};

test("the first PDF that opens wins, before any page is fetched", async () => {
  const d = deps({ candidates: [pdf("a.org"), pdf("b.org"), html("c.org")] }, (d) => ({
    fetchPdf: async (_id, url) => {
      d.tried.push(url);
      return url.includes("b.org") ? { ok: true } : { ok: false, reason: "not-pdf" };
    },
  }));
  const out = await findFreeCopy("p", {}, d);
  assert.equal(out.kind, "pdf");
  assert.deepEqual(d.tried, ["https://a.org/p.pdf", "https://b.org/p.pdf"]);
});

test("no PDF opens: a full-text page is sanitised, kept and returned", async () => {
  const d = deps({ candidates: [pdf("a.org"), html("c.org")] });
  const out = await findFreeCopy("p", {}, d);
  assert.equal(out.kind, "html");
  assert.deepEqual(d.saved, [
    {
      paperId: "p",
      url: "https://c.org/p",
      title: "T",
      html: `<p>${LONG}</p>`,
      savedAt: "2026-09-24T00:00:00.000Z",
    },
  ]);
});

test("attempts are bounded per format", async () => {
  const many = Array.from({ length: 10 }, (_, i) => [pdf(`p${i}.org`), html(`h${i}.org`)]).flat();
  const d = deps({ candidates: many }, (d) => ({
    fetchHtml: async (url) => {
      d.tried.push(url);
      return { ok: false, reason: "failed" };
    },
  }));
  none(await findFreeCopy("p", {}, d));
  assert.equal(d.tried.filter((u) => u.endsWith(".pdf")).length, MAX_PDF_ATTEMPTS);
  assert.equal(d.tried.filter((u) => !u.endsWith(".pdf")).length, MAX_HTML_ATTEMPTS);
});

test("nowhere to keep a PDF stops the PDF attempts but still tries pages", async () => {
  const d = deps({ candidates: [pdf("a.org"), pdf("b.org"), html("c.org")] }, (d) => ({
    fetchPdf: async (_id, url) => {
      d.tried.push(url);
      return { ok: false, reason: "no-cache" };
    },
  }));
  const out = await findFreeCopy("p", {}, d);
  assert.equal(out.kind, "html");
  assert.deepEqual(d.tried, ["https://a.org/p.pdf", "https://c.org/p"]);
});

test("an abstract-only page, a throwing fetch and a failed save are passed over", async () => {
  let n = 0;
  const d = deps({ candidates: [html("a.org"), html("b.org"), html("c.org")] }, () => ({
    fetchHtml: async (url) => {
      n += 1;
      if (n === 2) throw new Error("boom");
      return { ok: true, raw: n === 1 ? "short abstract" : LONG, finalUrl: url };
    },
    saveHtml: async () => {
      throw new Error("disk full");
    },
  }));
  const out = none(await findFreeCopy("p", {}, d));
  assert.deepEqual(
    out.attempts.map((a) => a.reason),
    ["abstract-only", "failed", "no-storage"],
  );
});

test("messages: no ids, every index down, nothing listed, some indexes down", () => {
  const base = { kind: "none" as const, listed: 0, attempts: [] };
  assert.match(describeFreeCopyFailure({ ...base, unreachable: [], asked: [] }), /no DOI, arXiv id or PubMed Central id/);
  assert.match(
    describeFreeCopyFailure({ ...base, asked: ["openalex", "hal"], unreachable: ["openalex", "hal"] }),
    /None of the open-access indexes could be reached/,
  );
  assert.equal(
    describeFreeCopyFailure({ ...base, asked: ["openalex"], unreachable: [] }),
    "No open-access index lists a free copy of this paper.",
  );
  assert.equal(
    describeFreeCopyFailure({ ...base, asked: ["openalex", "hal", "doaj"], unreachable: ["openalex", "hal"] }),
    "No open-access index lists a free copy of this paper. OpenAlex and HAL could not be reached, so try again later.",
  );
});

test("messages: found but none opened, with what each host did", () => {
  assert.equal(
    describeFreeCopyFailure({
      kind: "none",
      listed: 2,
      attempts: [
        { url: "https://a.org/p.pdf", format: "pdf", reason: "blocked" },
        { url: "https://b.org/p", format: "html", reason: "abstract-only" },
      ],
      unreachable: ["doaj"],
      asked: ["openalex", "doaj"],
    }),
    "Found 2 possible free copies, but none opened: a.org does not let the browser fetch it; b.org has only the abstract." +
      " Download it in a browser and use Load PDF… DOAJ could not be reached.",
  );
  assert.match(
    describeFreeCopyFailure({
      kind: "none",
      listed: 1,
      attempts: [{ url: "https://a.org/p.pdf", format: "pdf", reason: "no-storage" }],
      unreachable: [],
      asked: ["openalex"],
    }),
    /could not be kept here/,
  );
});

test("openAccessIdsOf takes the ids, a PDF-looking link as the PDF and any other as the page", () => {
  assert.deepEqual(
    openAccessIdsOf({ doi: "10.1/x", arxivId: null, url: "https://a.org/paper.pdf", metadata: { pmcid: "PMC1" } }),
    { doi: "10.1/x", arxivId: undefined, pmcid: "PMC1", knownPdfUrl: "https://a.org/paper.pdf", pageUrl: undefined },
  );
  const page = openAccessIdsOf({ url: "https://publisher.com/article/1" });
  assert.equal(page.knownPdfUrl, undefined);
  assert.equal(page.pageUrl, "https://publisher.com/article/1");
  assert.equal(openAccessIdsOf({ url: "javascript:alert(1)" }).pageUrl, undefined);
});

test("a blog post with no ids is a web article; one with a DOI is not", () => {
  assert.equal(isWebArticle(openAccessIdsOf({ url: "https://blog.example/post" })), true);
  assert.equal(isWebArticle(openAccessIdsOf({ url: "https://blog.example/post", doi: "10.1/x" })), false);
  assert.equal(isWebArticle(openAccessIdsOf({ url: "https://a.org/p.pdf" })), false);
});

test("a web article's own page is kept at a blog post's length, not a paper's", async () => {
  const post = "word ".repeat(400); // 2,000 characters: a short post, not an abstract
  const own: OpenAccessCandidate = { url: "https://blog.example/post", format: "html", source: "paper" };
  const d = deps({ candidates: [own], asked: [] }, (d) => ({
    fetchHtml: async (url) => {
      d.tried.push(url);
      return { ok: true, raw: post, finalUrl: url };
    },
  }));
  const out = await findFreeCopy("p", { pageUrl: own.url }, d);
  assert.equal(out.kind, "html");
  assert.equal(d.saved.length, 1);

  // The same length from a paper that has a DOI is its landing page.
  const withDoi = deps({ candidates: [own], asked: [] }, (d) => ({
    fetchHtml: async (url) => {
      d.tried.push(url);
      return { ok: true, raw: post, finalUrl: url };
    },
  }));
  const landing = none(await findFreeCopy("p", { pageUrl: own.url, doi: "10.1/x" }, withDoi));
  assert.equal(landing.attempts[0]?.reason, "abstract-only");
});

test("a web article that will not open says so about its own page", () => {
  const out: Extract<FreeCopyOutcome, { kind: "none" }> = {
    kind: "none",
    listed: 1,
    asked: [],
    unreachable: [],
    attempts: [{ url: "https://blog.example/post", format: "html", reason: "blocked" }],
  };
  assert.equal(
    describeFreeCopyFailure(out, true),
    "The page on blog.example refused to send it. Load a PDF of it instead, or open it in a browser.",
  );
});
