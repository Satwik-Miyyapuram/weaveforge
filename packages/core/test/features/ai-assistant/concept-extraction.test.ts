import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_EXTRACTION,
  LexicalConceptExtractor,
  conceptKey,
  mergeExtractions,
  planWikiPages,
  withoutExisting,
  type ExtractionResult,
} from "../../../src/index.js";

const extractor = new LexicalConceptExtractor();

const doc = (id: string, title: string, text: string) => ({ id, title, text });

// ----------------------------------------------------------- lexical extractor

test("hashtags and wikilinks are always kept — the user already committed to them", async () => {
  const result = await extractor.extract({
    documents: [doc("n1", "Note", "Working on #vae and [[Graph Neural Networks]].")],
  });

  const names = result.concepts.map((c) => conceptKey(c.name));
  assert.ok(names.includes("vae"), "a single hashtag still counts");
  assert.ok(names.includes("graph neural networks"));
});

test("a capitalised phrase in one document alone is treated as incidental", async () => {
  const once = await extractor.extract({ documents: [doc("n1", "N", "We used Adam here.")] });
  assert.ok(!once.concepts.some((c) => c.name === "Adam"));

  const twice = await extractor.extract({
    documents: [doc("n1", "N", "We used Adam here."), doc("n2", "M", "Adam again.")],
  });
  assert.ok(twice.concepts.some((c) => c.name === "Adam"));
});

test("sentence openings are not mistaken for names", async () => {
  const result = await extractor.extract({
    documents: [
      doc("n1", "N", "The results improved. However the baseline held. Therefore we stopped."),
      doc("n2", "M", "The results improved. However the baseline held. Therefore we stopped."),
    ],
  });

  const names = result.concepts.map((c) => c.name.toLowerCase());
  for (const stop of ["the", "however", "therefore"]) {
    assert.ok(!names.includes(stop), `"${stop}" should not be a concept`);
  }
});

test("code blocks and image markup are not mined for concepts", async () => {
  const result = await extractor.extract({
    documents: [
      doc("n1", "N", "```\nconst Foo = new Bar();\n```\n![](vault:u/n/Baz.png)"),
      doc("n2", "M", "```\nconst Foo = new Bar();\n```"),
    ],
  });

  assert.ok(!result.concepts.some((c) => /^(Foo|Bar|Baz)$/.test(c.name)));
});

test("acronyms are picked up and classified as methods", async () => {
  const result = await extractor.extract({
    documents: [doc("n1", "N", "We compare GAN results."), doc("n2", "M", "GAN again.")],
  });

  const gan = result.concepts.find((c) => c.name === "GAN");
  assert.ok(gan);
  assert.equal(gan!.kind, "method");
});

test("mentions carry evidence for the review queue", async () => {
  const result = await extractor.extract({
    documents: [doc("n1", "N", "The encoder uses #vae tricks throughout the pipeline.")],
  });

  const mention = result.mentions.find((m) => conceptKey(m.conceptName) === "vae");
  assert.ok(mention);
  assert.ok(mention!.evidence.length > 0);
});

test("extraction needs no model and no configuration", async () => {
  assert.equal(extractor.id, "lexical");
  assert.deepEqual(await extractor.extract({ documents: [] }), EMPTY_EXTRACTION);
});

test("maxConcepts caps the result and prunes orphaned mentions", async () => {
  const text = "AlphaOne BetaTwo GammaThree DeltaFour";
  const result = await extractor.extract({
    documents: [doc("n1", "N", text), doc("n2", "M", text)],
    maxConcepts: 2,
  });

  assert.ok(result.concepts.length <= 2);
  const kept = new Set(result.concepts.map((c) => conceptKey(c.name)));
  assert.ok(result.mentions.every((m) => kept.has(conceptKey(m.conceptName))));
});

// ------------------------------------------------ what the kind rules decide

test("acronyms we know are not all filed as methods", async () => {
  // "an acronym is a method" is a good default and a bad rule: the acronyms
  // research writing is full of are venues, datasets and metrics, and the
  // keyword rules below can never fire for an acronym because it contains no
  // such word. NEURIPS is seven letters, so the acronym pattern never even
  // matched it and it was dropped entirely.
  const result = await extractor.extract({
    documents: [
      doc("n1", "N", "Submitted to ICLR. The MNIST split. We report BLEU. Off to NEURIPS."),
      doc("n2", "M", "ICLR again, MNIST again, BLEU again, NEURIPS again."),
    ],
  });

  const kindOf = (name: string) =>
    result.concepts.find((c) => conceptKey(c.name) === name)?.kind;

  assert.equal(kindOf("iclr"), "venue");
  assert.equal(kindOf("neurips"), "venue");
  assert.equal(kindOf("mnist"), "dataset");
  assert.equal(kindOf("bleu"), "metric");
});

test("a stated link is classified too, not filed as a bare concept", async () => {
  const result = await extractor.extract({
    documents: [doc("n1", "N", "Trained on [[ImageNet]] and tagged #iclr for the deadline.")],
  });

  const kindOf = (name: string) =>
    result.concepts.find((c) => conceptKey(c.name) === name)?.kind;

  assert.equal(kindOf("imagenet"), "dataset");
  // The tag is lowercased on the way in; the acronym tables are case-insensitive
  // so that does not decide whether it is recognised.
  assert.equal(kindOf("iclr"), "venue");
});

test("an ordinary lowercase tag is not mistaken for an acronym", async () => {
  // The guard on the acronym rule: testing it case-insensitively would file
  // every short lowercase tag as a method.
  const result = await extractor.extract({
    documents: [doc("n1", "N", "Some #notes and #todo for later.")],
  });

  const kindOf = (name: string) =>
    result.concepts.find((c) => conceptKey(c.name) === name)?.kind;

  assert.equal(kindOf("notes"), "concept");
  assert.equal(kindOf("todo"), "concept");
});

test("a wikilink names nothing when it has no target", async () => {
  // `[[#Heading]]` links to a section of this note and `[[|alias]]` to nothing
  // at all: neither is a concept, and the two loops that derived the stated set
  // disagreed about it.
  const result = await extractor.extract({
    documents: [doc("n1", "N", "Jump to [[#Overview]] and to [[|alias]].")],
  });

  assert.deepEqual(result.concepts, []);
  assert.ok(!result.mentions.some((m) => conceptKey(m.conceptName) === ""));
});

test("a concept named only by a wikilink still carries evidence", async () => {
  // Evidence is read from the stripped text, and stripping is what removes
  // `[[…]]` — so this was the one case where the review queue's pane was blank:
  // a concept the user had stated outright.
  const result = await extractor.extract({
    documents: [doc("n1", "N", "See [[Graph Neural Networks]] for the details.")],
  });

  const mention = result.mentions.find(
    (m) => conceptKey(m.conceptName) === "graph neural networks",
  );
  assert.ok(mention);
  assert.ok(mention!.evidence.length > 0, "a stated concept must not arrive with empty evidence");
  assert.match(mention!.evidence, /Graph Neural Networks/);
});

test("one scan still finds the acronym inside a hyphenated phrase", async () => {
  // The two regex passes this replaces were not redundant: the phrase pattern
  // stops at "VAE-based" and the acronym pass added "VAE". A merged alternation
  // that let the phrase branch win at each position would lose the acronym —
  // which is why the match is read from the inside instead.
  const text = "VAE-based models are cheaper.";
  const result = await extractor.extract({
    documents: [doc("n1", "N", text), doc("n2", "M", text)],
  });

  const names = result.concepts.map((c) => conceptKey(c.name));
  assert.ok(names.includes("vae"), `expected the acronym; got ${names.join(", ")}`);
  assert.ok(names.includes("vae-based"), "and the phrase it sits in");
});

test("a stated tag corrects the name a guess froze first", async () => {
  // First-write-wins meant the mention recorded first kept the name for good, so
  // a deliberate tag could not correct a guess — the one signal the module's own
  // comments call stated, not inferred.
  const result = await extractor.extract({
    documents: [
      doc("n1", "N", "Our Transformer baseline."),
      doc("n2", "M", "Transformer again."),
      doc("n3", "P", "Tagged as #transformer in the plan."),
    ],
  });

  const concept = result.concepts.find((c) => conceptKey(c.name) === "transformer");
  assert.ok(concept);
  assert.equal(concept!.name, "transformer", "the tag's own spelling is the one kept");
});

test("a stated tag cannot downgrade a kind a rule recognised", async () => {
  // `#abc` lowercases on the way in, so the acronym rule no longer fires for it
  // and the tag classifies as the generic bucket. Merging on "the stated signal
  // wins" replaced the recognised "method" the phrase pass had already found.
  const result = await extractor.extract({
    documents: [
      doc("n1", "N", "We use ABC here."),
      doc("n2", "M", "ABC again."),
      doc("n3", "P", "Tagged #abc too."),
    ],
  });

  const concept = result.concepts.find((c) => conceptKey(c.name) === "abc");
  assert.ok(concept);
  assert.equal(concept!.kind, "method");
});

// -------------------------------------------------------------------- merging

test("merging sums mentions and unions aliases", () => {
  const a: ExtractionResult = {
    concepts: [{ name: "VAE", aliases: ["Variational Autoencoder"], kind: "method", mentions: 2 }],
    mentions: [{ documentId: "n1", conceptName: "VAE", evidence: "x" }],
  };
  const b: ExtractionResult = {
    concepts: [{ name: "vae", aliases: ["VAEs"], kind: "method", mentions: 3 }],
    mentions: [{ documentId: "n2", conceptName: "vae", evidence: "y" }],
  };

  const merged = mergeExtractions([a, b]);

  assert.equal(merged.concepts.length, 1, "case differences are the same concept");
  assert.equal(merged.concepts[0]!.mentions, 5);
  assert.equal(merged.concepts[0]!.aliases.length, 2);
  assert.equal(merged.mentions.length, 2);
});

test("a pending result marks the merge pending, so empty is not read as 'nothing found'", () => {
  const merged = mergeExtractions([EMPTY_EXTRACTION, { ...EMPTY_EXTRACTION, pending: true }]);

  assert.equal(merged.pending, true);
});

test("duplicate mentions of one concept in one document collapse", () => {
  const merged = mergeExtractions([
    { concepts: [], mentions: [{ documentId: "n1", conceptName: "VAE", evidence: "a" }] },
    { concepts: [], mentions: [{ documentId: "n1", conceptName: "vae", evidence: "b" }] },
  ]);

  assert.equal(merged.mentions.length, 1);
});

// ------------------------------------------------------------------- planning

const extraction: ExtractionResult = {
  concepts: [
    { name: "VAE", aliases: ["Variational Autoencoder"], kind: "method", mentions: 3 },
    { name: "Rare", aliases: [], kind: "concept", mentions: 1 },
  ],
  mentions: [
    { documentId: "n1", conceptName: "VAE", evidence: "uses a VAE encoder" },
    { documentId: "n2", conceptName: "VAE", evidence: "the VAE again" },
    { documentId: "n3", conceptName: "Rare", evidence: "Rare once" },
  ],
};

test("only concepts worth a page are planned", () => {
  const plans = planWikiPages({ extraction, existingTitles: [] });

  assert.equal(plans.length, 1);
  assert.equal(plans[0]!.title, "VAE");
});

test("planning is idempotent — a second run proposes nothing new", () => {
  const first = planWikiPages({ extraction, existingTitles: [] });
  const second = planWikiPages({
    extraction,
    existingTitles: first.map((plan) => plan.title),
  });

  assert.deepEqual(second, [], "the review queue must not fill with duplicates");
});

test("an alias colliding with an existing page suppresses the concept", () => {
  // Proposing "VAE" when "Variational Autoencoder" exists would create exactly
  // the duplicate the alias is there to prevent.
  const plans = planWikiPages({ extraction, existingTitles: ["Variational Autoencoder"] });

  assert.deepEqual(plans, []);
});

test("a page links its sources and does not invent a definition", () => {
  const plans = planWikiPages({
    extraction,
    existingTitles: [],
    titleOf: (id) => ({ n1: "Method", n2: "Results" })[id],
  });

  const body = plans[0]!.body;
  assert.match(body, /\[\[Method\]\]/);
  assert.match(body, /\[\[Results\]\]/);
  assert.match(body, /_Not written yet\._/, "a confident invented summary is the failure mode");
  assert.match(body, /#method/, "the kind is recorded as a tag");
});

test("source documents are deduplicated and reported", () => {
  const plans = planWikiPages({ extraction, existingTitles: [] });

  assert.deepEqual(plans[0]!.sourceDocumentIds, ["n1", "n2"]);
  assert.equal(plans[0]!.mentions, 3);
});

test("maxPages bounds a large extraction", () => {
  const many: ExtractionResult = {
    concepts: Array.from({ length: 50 }, (_, i) => ({
      name: `Concept${i}`, aliases: [], kind: "concept" as const, mentions: 5,
    })),
    mentions: [],
  };

  assert.equal(planWikiPages({ extraction: many, existingTitles: [], maxPages: 10 }).length, 10);
});

test("withoutExisting prunes mentions along with their concept", () => {
  const pruned = withoutExisting(extraction, ["VAE"]);

  assert.ok(!pruned.concepts.some((c) => c.name === "VAE"));
  assert.ok(!pruned.mentions.some((m) => m.conceptName === "VAE"));
});
