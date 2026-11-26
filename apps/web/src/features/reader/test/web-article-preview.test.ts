import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planWebArticle, resolveAccount } from "../ui/web-article-preview";
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

test("only http and https page addresses are linked; anything else has nothing to show", () => {
  for (const pageUrl of ["javascript:alert(1)", "file:///C:/secret.html", "data:text/html,hi", "not a url"]) {
    assert.deepEqual(planWebArticle({ kept: false, pageUrl, fetchFailed: true }), { kind: "none" }, pageUrl);
    assert.deepEqual(planWebArticle({ kept: false, pageUrl, fetchFailed: false }), { kind: "none" }, pageUrl);
  }
});

test("the live fallback host comes from the shared safeHostname", () => {
  assert.deepEqual(planWebArticle({ kept: false, pageUrl: "https://Labs.Baseten.co/a", fetchFailed: true }), {
    kind: "live",
    url: "https://Labs.Baseten.co/a",
    host: "labs.baseten.co",
  });
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

test("a signed-out web reader sees a sign-in card, not the live-page card, when the page cannot be fetched", () => {
  assert.deepEqual(planWebArticle({ kept: false, pageUrl: ARTICLE, fetchFailed: true, needsSignIn: true }), {
    kind: "sign-in",
    host: "labs.baseten.co",
  });
  assert.deepEqual(planWebArticle({ kept: false, pageUrl: ARTICLE, fetchFailed: false, needsSignIn: true }), {
    kind: "sign-in",
    host: "labs.baseten.co",
  });
});

test("only a web reader with no token is signed out; a token failure is unknown, not signed out", async () => {
  const noToken = async () => null;
  const rejects = async () => {
    throw new Error("auth locked");
  };
  assert.equal(await resolveAccount(true, async () => "token"), "signed-in");
  assert.equal(await resolveAccount(true, noToken), "signed-out");
  assert.equal(await resolveAccount(true, rejects), "unknown");
});

test("local mode never needs sign-in, so its failed fetch shows the live page", async () => {
  assert.equal(await resolveAccount(false, async () => null), "signed-in");
  assert.equal(await resolveAccount(false, async () => null), "signed-in");
  assert.deepEqual(
    planWebArticle({ kept: false, pageUrl: ARTICLE, fetchFailed: true, needsSignIn: false }),
    { kind: "live", url: ARTICLE, host: "labs.baseten.co" },
  );
});

test("the sign-in card has a sign-in action wired to the existing Google sign-in", () => {
  const source = readFileSync(new URL("../ui/paper-pdf-pane.tsx", import.meta.url), "utf8");
  const card = source.slice(source.indexOf('articlePlan?.kind === "sign-in"'));
  const block = card.slice(0, card.indexOf('articlePlan?.kind === "none"'));
  assert.match(block, /signInWithGoogle\(authRedirectTo\(\)\)/);
});

test("a kept page still wins over sign-in, and no page address still has nothing to show", () => {
  assert.deepEqual(planWebArticle({ kept: true, pageUrl: ARTICLE, fetchFailed: true, needsSignIn: true }), { kind: "kept" });
  assert.deepEqual(planWebArticle({ kept: false, pageUrl: null, fetchFailed: true, needsSignIn: true }), { kind: "none" });
});