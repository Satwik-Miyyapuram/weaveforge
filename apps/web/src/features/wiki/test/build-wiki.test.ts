import assert from "node:assert/strict";
import test from "node:test";
import { LexicalConceptExtractor, lintWiki, planFixOrder, planWikiPages } from "@weaveforge/core";

/**
 * The wiki screen's pipeline, exercised without a container: extract from
 * source documents, plan pages, and lint what already exists. The screen wires
 * these to the workspace snapshot and the proposal queue; the behaviour that
 * matters is here.
 */

const extractor = new LexicalConceptExtractor();

const doc = (id: string, title: string, text: string) => ({ id, title, text });

test("a scan over notes and papers proposes pages for repeated concepts", async () => {
  const documents = [
    doc("n1", "Method", "We train a #vae on the corpus and compare against GAN baselines."),
    doc("p1", "A paper", "The GAN baseline underperforms on this dataset."),
  ];

  const extraction = await extractor.extract({ documents, existingConcepts: [] });
  const plans = planWikiPages({
    extraction,
    existingTitles: [],
    titleOf: (id) => documents.find((d) => d.id === id)?.title,
  });

  assert.ok(
    plans.some((plan) => plan.title === "GAN"),
    "a concept appearing in two documents earns a page",
  );
});

test("a generated page links back to the documents it came from", async () => {
  const documents = [
    doc("n1", "Method", "The GAN setup is described here."),
    doc("n2", "Results", "The GAN results are below."),
  ];

  const extraction = await extractor.extract({ documents, existingConcepts: [] });
  const plans = planWikiPages({
    extraction,
    existingTitles: [],
    titleOf: (id) => documents.find((d) => d.id === id)?.title,
  });

  const gan = plans.find((plan) => plan.title === "GAN")!;
  assert.ok(gan, "expected a GAN page");
  assert.match(gan.body, /\[\[Method\]\]/);
  assert.match(gan.body, /\[\[Results\]\]/);
});

test("a second scan proposes nothing once the pages exist", async () => {
  const documents = [
    doc("n1", "Method", "The GAN setup is described here."),
    doc("n2", "Results", "The GAN results are below."),
  ];

  const extraction = await extractor.extract({ documents, existingConcepts: [] });
  const first = planWikiPages({ extraction, existingTitles: [] });
  const second = planWikiPages({
    extraction,
    existingTitles: first.map((plan) => plan.title),
  });

  assert.ok(first.length > 0);
  assert.deepEqual(second, [], "re-running must not refill the review queue");
});

test("generated pages are linted like any other page", () => {
  // A freshly generated page has no prose of its own, which lint reports as
  // empty — that is the nudge to write the summary, not a defect.
  const generated = [
    "## Summary",
    "",
    "_Not written yet._",
    "",
    "## Mentioned in",
    "",
    "- [[Method]]",
  ].join("\n");

  const report = lintWiki([
    { id: "w1", title: "GAN", body: generated },
    { id: "w2", title: "Method", body: "Real prose describing the method at some length." },
  ]);

  assert.ok(report.findings.some((f) => f.kind === "empty" && f.pageId === "w1"));
});

test("lint orders duplicate merges before link repair", () => {
  const report = lintWiki([
    { id: "a", title: "GAN", body: "One." },
    { id: "b", title: "gan", body: "Two." },
    { id: "c", title: "Method", body: "Links to [[Missing]] in a sentence of some length." },
  ]);

  const order = planFixOrder(report).map((step) => step.kind);
  assert.ok(order.indexOf("duplicate") < order.indexOf("dead-link"));
});

test("an empty wiki produces no findings and no plans", async () => {
  assert.deepEqual(lintWiki([]).findings, []);
  const extraction = await extractor.extract({ documents: [] });
  assert.deepEqual(planWikiPages({ extraction, existingTitles: [] }), []);
});

test("the index the screen rebuilds reflects the pages lint sees", async () => {
  const { buildWikiIndex, replaceWikiIndex } = await import("@weaveforge/core");
  const pages = [
    { id: "w1", title: "GAN", body: "A generative adversarial network." },
    { id: "w2", title: "VAE", body: "A variational autoencoder." },
  ];

  const root = replaceWikiIndex("Notes about the wiki.\n", buildWikiIndex(pages));
  assert.ok(root.includes("- [[GAN]]"));
  assert.ok(root.includes("- [[VAE]]"));

  // A page removed by a merge must leave the index on the next rebuild.
  const afterMerge = replaceWikiIndex(root, buildWikiIndex(pages.slice(0, 1)));
  assert.ok(afterMerge.includes("- [[GAN]]"));
  assert.ok(!afterMerge.includes("- [[VAE]]"));
  assert.ok(afterMerge.startsWith("Notes about the wiki."));
});

test("dead links name the target the screen queues a page for", () => {
  const report = lintWiki([
    { id: "w1", title: "GAN", body: "Compare with [[Diffusion Model]] and [[Diffusion Model]]." },
  ]);

  const targets = [
    ...new Set(
      report.findings
        .filter((finding) => finding.kind === "dead-link")
        .map((finding) => finding.target)
        .filter((target): target is string => !!target),
    ),
  ];

  assert.deepEqual(targets, ["Diffusion Model"], "one missing page, however many links point at it");
});
