import assert from "node:assert/strict";
import test from "node:test";
import { planWebArticle } from "../ui/web-article-preview";
import { routePdfHit } from "../ui/pdf-hit-route";

// The exact article from the report (labs.baseten.co): no PDF, so its page is the paper.
const ARTICLE = "https://labs.baseten.co/articles/the-bias-of-on-policy-self-distillation";
const GITHUB_HIT = "/api/github-file?path=papers%2Fpdf%2Fp1.pdf";

test("an article hit routes to the web preview, not a PDF download", () => {
  assert.equal(
    routePdfHit({ url: GITHUB_HIT, resolverId: "github-repo", localMode: true, stored: false, webArticle: true }),
    "web-page",
  );
});

test("an article with no kept page is fetched and kept, not shown as an error", () => {
  assert.deepEqual(planWebArticle({ kept: false, pageUrl: ARTICLE, fetchFailed: false }), { kind: "fetch" });
});

test("a kept page is shown as is", () => {
  assert.deepEqual(planWebArticle({ kept: true, pageUrl: ARTICLE, fetchFailed: false }), { kind: "kept" });
  assert.deepEqual(planWebArticle({ kept: true, pageUrl: ARTICLE, fetchFailed: true }), { kind: "kept" });
});

test("a failed fetch shows the live page with an open-in-browser link", () => {
  assert.deepEqual(planWebArticle({ kept: false, pageUrl: ARTICLE, fetchFailed: true }), {
    kind: "live",
    url: ARTICLE,
    host: "labs.baseten.co",
  });
});

test("an article without a page address has nothing to preview", () => {
  assert.deepEqual(planWebArticle({ kept: false, pageUrl: null, fetchFailed: false }), { kind: "none" });
  assert.deepEqual(planWebArticle({ kept: false, pageUrl: "", fetchFailed: true }), { kind: "none" });
});

test("the plan never asks for a PDF download", () => {
  for (const fetchFailed of [false, true]) {
    for (const kept of [false, true]) {
      assert.notEqual(planWebArticle({ kept, pageUrl: ARTICLE, fetchFailed }).kind, "download");
    }
  }
});

test("a real PDF on a web-article paper is unchanged: it still opens or downloads as before", () => {
  assert.equal(
    routePdfHit({ url: "https://arxiv.org/pdf/2301.00001", resolverId: "open-access", localMode: true, stored: false, webArticle: true }),
    "download",
  );
  assert.equal(
    routePdfHit({ url: "cache://p1", resolverId: "browser-cache", localMode: true, stored: true, webArticle: true }),
    "open",
  );
});
