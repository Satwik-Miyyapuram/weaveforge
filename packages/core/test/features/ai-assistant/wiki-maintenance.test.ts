import assert from "node:assert/strict";
import test from "node:test";
import type { WikiPageRef } from "../../../src/index.js";
import * as wasm from "../../../../wf-wasm/src/index.ts";
import { rust } from "../../../src/shared/rust.js";

// Their TypeScript was removed; the Rust core is the implementation.
const { mergeWikiPages } = wasm;

const page = (id: string, title: string, body = "Some real content that is long enough to count."): WikiPageRef =>
  ({ id, title, body });

// ----------------------------------------------------------------------- lint

test("exact duplicate titles are errors", () => {
  const report = rust().lintWiki([page("a", "VAE"), page("b", "vae")]);

  assert.equal(report.counts.duplicate, 1);
  const finding = report.findings.find((f) => f.kind === "duplicate")!;
  assert.equal(finding.severity, "error");
  assert.equal(finding.relatedPageId, "a");
});

test("near-duplicate titles are flagged for review, not merged automatically", () => {
  const report = rust().lintWiki([
    page("a", "Variational Autoencoder"),
    page("b", "Variational Autoencoders"),
  ]);

  assert.equal(report.counts["near-duplicate"], 1);
  assert.equal(report.findings.find((f) => f.kind === "near-duplicate")!.severity, "warning");
});

test("unrelated titles are not flagged", () => {
  const report = rust().lintWiki([page("a", "Graph Neural Networks"), page("b", "Reinforcement Learning")]);

  assert.equal(report.counts["near-duplicate"], 0);
});

test("similarity catches reordering, which edit distance would miss", () => {
  const nearDuplicates = (a: string, b: string) =>
    rust().lintWiki([page("a", a), page("b", b)]).counts["near-duplicate"];
  assert.equal(nearDuplicates("Variational Autoencoder", "Autoencoder, Variational"), 1);
  assert.equal(nearDuplicates("Attention", "Reinforcement Learning"), 0);
});

test("links to missing pages are reported with the target", () => {
  const report = rust().lintWiki([page("a", "Method", "See [[Nowhere]] for details, at some length.")]);

  const dead = report.findings.find((f) => f.kind === "dead-link")!;
  assert.equal(dead.target, "Nowhere");
  assert.equal(report.counts["dead-link"], 1);
});

test("a link resolving through an alias is not dead", () => {
  const report = rust().lintWiki([
    { id: "a", title: "Source", body: "Links to [[VAE]] in a sentence long enough to count." },
    { id: "b", title: "Variational Autoencoder", body: "Real content here for the length check.", aliases: ["VAE"] },
  ]);

  assert.equal(report.counts["dead-link"], 0);
});

test("a link to a note or paper outside the wiki is not dead (E39)", () => {
  // A drafted page lists the notes and papers it came from. They exist, just
  // not as wiki pages; calling them dead offered to create notes named after papers.
  const report = rust().lintWiki(
    [page("a", "ResNet", "From [[Deep Residual Learning]] and [[Method]], at some length.")],
    ["deep residual learning", "Method"],
  );

  assert.equal(report.counts["dead-link"], 0);
});

test("a link to nothing at all is still dead with other titles given", () => {
  const report = rust().lintWiki([page("a", "ResNet", "See [[Nowhere]] for details, at some length.")], ["Method"]);

  assert.equal(report.counts["dead-link"], 1);
});

test("a page with only structure is reported as empty", () => {
  const generated = ["## Summary", "", "_Not written yet._", "", "## Mentioned in", "", "- [[Method]]", "", "#concept"].join("\n");

  const report = rust().lintWiki([page("a", "VAE", generated), page("m", "Method")]);

  assert.ok(report.findings.some((f) => f.kind === "empty" && f.pageId === "a"));
});

test("a page that links out is not an orphan even with no inbound links", () => {
  const report = rust().lintWiki([
    page("a", "Source", "Points at [[Target]] with enough words to pass the length check."),
    page("b", "Target"),
  ]);

  // "a" has no inbound links but participates; "b" is linked to.
  assert.equal(report.counts.orphan, 0);
});

test("a page with no edges at all is an orphan", () => {
  const report = rust().lintWiki([page("a", "Adrift")]);

  assert.equal(report.counts.orphan, 1);
  assert.equal(report.findings.find((f) => f.kind === "orphan")!.severity, "info");
});

test("a clean wiki reports nothing", () => {
  const report = rust().lintWiki([
    page("a", "Method", "Real prose about the method, linking to [[Baselines]] for comparison."),
    page("b", "Baselines", "Real prose about baselines, linking back to [[Method]] here."),
  ]);

  assert.deepEqual(report.findings, []);
});

test("an empty wiki lints without throwing", () => {
  assert.deepEqual(rust().lintWiki([]).findings, []);
});

// -------------------------------------------------------------------- fix plan

test("duplicates are fixed before dead links", () => {
  const report = rust().lintWiki([
    page("a", "VAE"),
    page("b", "vae"),
    page("c", "Method", "Links to [[Nowhere]] in a sentence with enough words."),
  ]);

  const order = rust().planFixOrder(report).map((step) => step.kind);

  // Merging removes pages, which both resolves and creates dead links; fixing
  // links first would repair links into a page about to disappear.
  assert.ok(order.indexOf("duplicate") < order.indexOf("dead-link"));
});

test("steps with no findings are omitted", () => {
  const plan = rust().planFixOrder(rust().lintWiki([page("a", "Adrift")]));

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

// ------------------------------------------------- lint cost (02-02, 02-16)

const WORDS = ["neural", "graph", "attention", "variational", "autoencoder", "diffusion", "transformer",
  "kernel", "bayesian", "sparse", "contrastive", "learning", "model", "network", "inference"];
const manyPages = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    page(String(i), `${WORDS[i % 15]} ${WORDS[(i * 7) % 15]} ${WORDS[(i * 11) % 13]} ${i}`));

test("linting a 2000-page wiki does not rebuild title trigrams per pair", () => {
  const pages = manyPages(2000);
  const started = performance.now();
  rust().lintWiki(pages);
  // Rebuilding both trigram sets for each of the ~2M pairs took ~20 s here.
  assert.ok(performance.now() - started < 8000, `took ${Math.round(performance.now() - started)} ms`);
});

test("a page whose only link has a blank target links out, and is neither orphan nor dead", () => {
  for (const link of ["[[ ]]", "[[|alias]]", "[[#Section]]"]) {
    const report = rust().lintWiki([page("a", "Stub", `Real prose about a stub, with a ${link} link in it.`)]);
    assert.equal(report.counts.orphan, 0, link);
    assert.equal(report.counts["dead-link"], 0, link);
  }
});

test("frontmatter is not content, and the prose after it is", () => {
  const fm = "---\ntags: [x]\nsummary: a long line of metadata that is not prose at all\n---\n";
  assert.equal(rust().lintWiki([page("a", "A", `${fm}# A\n`)]).counts.empty, 1);
  assert.equal(rust().lintWiki([page("a", "A", `${fm}Real prose about this page, long enough to count.`)]).counts.empty, 0);
  // An unclosed fence is not frontmatter: the text stays content.
  assert.equal(rust().lintWiki([page("a", "A", "---\nReal prose about this page, long enough to count.")]).counts.empty, 0);
});

test("a body of dashes with no closing fence lints in linear time", () => {
  const started = performance.now();
  rust().lintWiki([page("a", "A", "---" + "-".repeat(200_000))]);
  assert.ok(performance.now() - started < 1000, `took ${Math.round(performance.now() - started)} ms`);
});

test("headings and bullet markers are not content, and long runs of spaces lint fast", () => {
  assert.equal(rust().lintWiki([page("a", "A", "# A heading that is long enough to count as text\n-   \n")]).counts.empty, 1);
  assert.equal(rust().lintWiki([page("a", "A", "## Part\n- Real prose in a bullet, long enough to count.")]).counts.empty, 0);
  const started = performance.now();
  rust().lintWiki([page("a", "A", "#" + " ".repeat(100_000) + "x\n" + " ".repeat(100_000) + "-")]);
  assert.ok(performance.now() - started < 1000, `took ${Math.round(performance.now() - started)} ms`);
});
