import assert from "node:assert/strict";
import test from "node:test";
import {
  NEAR_DUPLICATE_THRESHOLD,
  lintWiki,
  mergeWikiPages,
  planFixOrder,
  titleSimilarity,
  type WikiPageRef,
} from "../../../src/index.js";

const page = (id: string, title: string, body = "Some real content that is long enough to count."): WikiPageRef =>
  ({ id, title, body });

// ----------------------------------------------------------------------- lint

test("exact duplicate titles are errors", () => {
  const report = lintWiki([page("a", "VAE"), page("b", "vae")]);

  assert.equal(report.counts.duplicate, 1);
  const finding = report.findings.find((f) => f.kind === "duplicate")!;
  assert.equal(finding.severity, "error");
  assert.equal(finding.relatedPageId, "a");
});

test("near-duplicate titles are flagged for review, not merged automatically", () => {
  const report = lintWiki([
    page("a", "Variational Autoencoder"),
    page("b", "Variational Autoencoders"),
  ]);

  assert.equal(report.counts["near-duplicate"], 1);
  assert.equal(report.findings.find((f) => f.kind === "near-duplicate")!.severity, "warning");
});

test("unrelated titles are not flagged", () => {
  const report = lintWiki([page("a", "Graph Neural Networks"), page("b", "Reinforcement Learning")]);

  assert.equal(report.counts["near-duplicate"], 0);
});

test("similarity catches reordering, which edit distance would miss", () => {
  assert.ok(titleSimilarity("Variational Autoencoder", "Variational Autoencoders") > NEAR_DUPLICATE_THRESHOLD);
  assert.ok(titleSimilarity("Attention", "Reinforcement Learning") < NEAR_DUPLICATE_THRESHOLD);
  assert.equal(titleSimilarity("", ""), 0);
});

test("links to missing pages are reported with the target", () => {
  const report = lintWiki([page("a", "Method", "See [[Nowhere]] for details, at some length.")]);

  const dead = report.findings.find((f) => f.kind === "dead-link")!;
  assert.equal(dead.target, "Nowhere");
  assert.equal(report.counts["dead-link"], 1);
});

test("a link resolving through an alias is not dead", () => {
  const report = lintWiki([
    { id: "a", title: "Source", body: "Links to [[VAE]] in a sentence long enough to count." },
    { id: "b", title: "Variational Autoencoder", body: "Real content here for the length check.", aliases: ["VAE"] },
  ]);

  assert.equal(report.counts["dead-link"], 0);
});

test("a page with only structure is reported as empty", () => {
  const generated = ["## Summary", "", "_Not written yet._", "", "## Mentioned in", "", "- [[Method]]", "", "#concept"].join("\n");

  const report = lintWiki([page("a", "VAE", generated), page("m", "Method")]);

  assert.ok(report.findings.some((f) => f.kind === "empty" && f.pageId === "a"));
});

test("a page that links out is not an orphan even with no inbound links", () => {
  const report = lintWiki([
    page("a", "Source", "Points at [[Target]] with enough words to pass the length check."),
    page("b", "Target"),
  ]);

  // "a" has no inbound links but participates; "b" is linked to.
  assert.equal(report.counts.orphan, 0);
});

test("a page with no edges at all is an orphan", () => {
  const report = lintWiki([page("a", "Adrift")]);

  assert.equal(report.counts.orphan, 1);
  assert.equal(report.findings.find((f) => f.kind === "orphan")!.severity, "info");
});

test("a clean wiki reports nothing", () => {
  const report = lintWiki([
    page("a", "Method", "Real prose about the method, linking to [[Baselines]] for comparison."),
    page("b", "Baselines", "Real prose about baselines, linking back to [[Method]] here."),
  ]);

  assert.deepEqual(report.findings, []);
});

test("an empty wiki lints without throwing", () => {
  assert.deepEqual(lintWiki([]).findings, []);
});

// -------------------------------------------------------------------- fix plan

test("duplicates are fixed before dead links", () => {
  const report = lintWiki([
    page("a", "VAE"),
    page("b", "vae"),
    page("c", "Method", "Links to [[Nowhere]] in a sentence with enough words."),
  ]);

  const order = planFixOrder(report).map((step) => step.kind);

  // Merging removes pages, which both resolves and creates dead links; fixing
  // links first would repair links into a page about to disappear.
  assert.ok(order.indexOf("duplicate") < order.indexOf("dead-link"));
});

test("steps with no findings are omitted", () => {
  const plan = planFixOrder(lintWiki([page("a", "Adrift")]));

  assert.ok(plan.every((step) => step.findings.length > 0));
  assert.ok(!plan.some((step) => step.kind === "duplicate"));
});

// ---------------------------------------------------------------------- merge

test("the absorbed title becomes an alias so links keep resolving", () => {
  const result = mergeWikiPages(
    { id: "a", title: "Variational Autoencoder", body: "The primary text." },
    { id: "b", title: "VAE", body: "Some other text." },
  );

  assert.equal(result.title, "Variational Autoencoder");
  assert.ok(result.aliases.includes("VAE"));
});

test("unique content from both pages survives", () => {
  const result = mergeWikiPages(
    { id: "a", title: "A", body: "Encoders map inputs to a latent distribution." },
    { id: "b", title: "B", body: "Decoders reconstruct the original observation." },
  );

  assert.match(result.body, /Encoders map inputs/);
  assert.match(result.body, /Decoders reconstruct/);
});

test("a statement repeated on both pages is not duplicated", () => {
  const shared = "Encoders map inputs to a latent distribution.";
  const result = mergeWikiPages(
    { id: "a", title: "A", body: shared },
    { id: "b", title: "B", body: shared },
  );

  assert.equal(result.body.split("Encoders map inputs").length - 1, 1);
});

test("contradictions are kept side by side, never resolved", () => {
  const result = mergeWikiPages(
    { id: "a", title: "Primary", body: "The model improves reconstruction quality substantially." },
    { id: "b", title: "Secondary", body: "The model does not improve reconstruction quality substantially." },
  );

  assert.equal(result.contradictions.length, 1);
  assert.match(result.body, /Conflicting notes/);
  // Both survive: picking a winner is the judgement a merge tool must not make.
  assert.match(result.body, /\*\*Primary:\*\*/);
  assert.match(result.body, /\*\*Secondary:\*\*/);
});

test("sources from both pages are unioned", () => {
  const result = mergeWikiPages(
    { id: "a", title: "A", body: "x", sources: ["n1", "n2"] },
    { id: "b", title: "B", body: "y", sources: ["n2", "n3"] },
  );

  assert.deepEqual(result.sources.sort(), ["n1", "n2", "n3"]);
});

test("the primary's own title is not added as an alias of itself", () => {
  const result = mergeWikiPages(
    { id: "a", title: "VAE", body: "x" },
    { id: "b", title: "vae", body: "y" },
  );

  assert.deepEqual(result.aliases, []);
});

test("merging an empty page changes nothing but the aliases", () => {
  const result = mergeWikiPages(
    { id: "a", title: "A", body: "Original content stays." },
    { id: "b", title: "B", body: "" },
  );

  assert.match(result.body, /Original content stays/);
  assert.deepEqual(result.contradictions, []);
});
