import assert from "node:assert/strict";
import test from "node:test";
import { fetchServedPdf, routePdfHit, safeHostname } from "../ui/pdf-hit-route";

// The exact article from the crash report (labs.baseten.co). Its PDF ladder finds
// no PDF (resolve_paper_pdf_url -> null), so the GitHub-repo step answers with its
// guessed same-origin path, and the paper counts as a web article (isWebArticle).
const ARTICLE = "https://labs.baseten.co/articles/the-bias-of-on-policy-self-distillation";
const GITHUB_HIT = "/api/github-file?path=papers%2Fpdf%2Fp1.pdf";

test("safeHostname returns the host for a valid URL and the raw text otherwise", () => {
  assert.equal(safeHostname(ARTICLE), "labs.baseten.co");
  assert.equal(safeHostname(GITHUB_HIT), GITHUB_HIT);
  assert.equal(safeHostname("not a url"), "not a url");
  assert.equal(safeHostname(""), "");
});

test("a relative resolver hit for an article is routed to the web page, without throwing", () => {
  const route = () =>
    routePdfHit({ url: GITHUB_HIT, resolverId: "github-repo", localMode: true, stored: false, webArticle: true });
  assert.doesNotThrow(route);
  assert.equal(route(), "web-page");
});

test("a relative or vault path for a paper that is not an article opens locally, never as a download", () => {
  assert.equal(
    routePdfHit({ url: GITHUB_HIT, resolverId: "github-repo", localMode: true, stored: false, webArticle: false }),
    "open",
  );
  assert.equal(
    routePdfHit({ url: "papers/pdf/p1.pdf", resolverId: "github-repo", localMode: true, stored: false, webArticle: false }),
    "open",
  );
});

test("stored PDFs (blob and cache) open locally", () => {
  assert.equal(
    routePdfHit({ url: "cache://p1", resolverId: "browser-cache", localMode: true, stored: true, webArticle: false }),
    "open",
  );
  assert.equal(
    routePdfHit({ url: "blob:https://weaveforge.test/2f1c", resolverId: "x", localMode: true, stored: true, webArticle: false }),
    "open",
  );
});

test("an absolute https PDF not on this computer is offered as a download", () => {
  assert.equal(
    routePdfHit({ url: "https://arxiv.org/pdf/2301.00001", resolverId: "open-access", localMode: true, stored: false, webArticle: false }),
    "download",
  );
});

test("outside local mode every hit opens directly", () => {
  assert.equal(
    routePdfHit({ url: "https://arxiv.org/pdf/2301.00001", resolverId: "open-access", localMode: false, stored: false, webArticle: false }),
    "open",
  );
});

test("a GitHub-repo guess for a paper that is not an article, with no such file, falls through to the no-PDF fallback", () => {
  assert.equal(
    routePdfHit({ url: GITHUB_HIT, resolverId: "github-repo", localMode: true, stored: false, webArticle: false, guessFound: false }),
    "none",
  );
});

test("a GitHub-repo guess whose file exists opens as before", () => {
  assert.equal(
    routePdfHit({ url: GITHUB_HIT, resolverId: "github-repo", localMode: true, stored: false, webArticle: false, guessFound: true }),
    "open",
  );
});

test("fetchServedPdf is a single GET: its bytes on 200, null for anything else or a failed request", async () => {
  const seen: string[] = [];
  const answer = (status: number) => async (url: string, init?: RequestInit) => {
    seen.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(status === 200 ? "%PDF-1.4" : null, { status });
  };
  const blob = await fetchServedPdf(GITHUB_HIT, answer(200));
  assert.ok(blob instanceof Blob);
  assert.equal(await blob.text(), "%PDF-1.4");
  assert.equal(await fetchServedPdf(GITHUB_HIT, answer(404)), null);
  assert.equal(await fetchServedPdf(GITHUB_HIT, answer(204)), null);
  assert.equal(
    await fetchServedPdf(GITHUB_HIT, async () => {
      throw new TypeError("network");
    }),
    null,
  );
  assert.ok(seen.every((line) => line.startsWith("GET ")));
});
