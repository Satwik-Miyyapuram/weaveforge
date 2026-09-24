import assert from "node:assert/strict";
import test from "node:test";
import type { EmbedRequest, IEmbedder, SearchDoc } from "@weaveforge/core";
import { SemanticIndex, documentIdOf } from "@/features/search/application/semantic-index";

/**
 * A deterministic stand-in for the encoder.
 *
 * Three axes standing for three topics, scored by term presence. Crude, but it
 * has the property that matters: text about the same thing points the same way,
 * regardless of which words it uses — which is exactly the behaviour the real
 * encoder is bought for, and the thing a keyword index cannot do.
 */
const TOPICS: Record<string, readonly string[]> = {
  attention: ["attention", "transformer", "self-attention", "positions", "sequence"],
  vae: ["vae", "autoencoder", "latent", "posterior", "reparameterisation"],
  optimizer: ["adam", "sgd", "learning rate", "gradient", "momentum"],
};

class TopicEmbedder implements IEmbedder {
  readonly id = "stub-topics-v1";
  readonly dimensions = 3;
  calls: EmbedRequest[] = [];

  async embed(request: EmbedRequest): Promise<Float32Array[]> {
    this.calls.push(request);
    return request.texts.map((text) => {
      const lower = text.toLowerCase();
      const axes = Object.values(TOPICS).map(
        (terms): number => terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0),
      );
      // Never all-zero: a zero vector matches nothing, which would make the
      // test pass for the wrong reason.
      return Float32Array.from(axes.every((value) => value === 0) ? [0.01, 0, 0] : axes);
    });
  }
}

const doc = (id: string, title: string, body: string): SearchDoc => ({
  id,
  kind: "note",
  entityId: id.split(":")[1] ?? id,
  title,
  aliases: [],
  headings: [],
  tags: [],
  path: "",
  body,
  updatedAt: "2026-01-01T00:00:00.000Z",
  href: `/notes?page=${id}`,
  degree: 0,
});

const CORPUS = [
  doc("note:a", "Method", "The transformer weighs every position in the sequence against every other."),
  doc("note:b", "Latents", "The autoencoder learns a latent posterior with the reparameterisation trick."),
  doc("note:c", "Training", "We use Adam with a warmup learning rate and momentum."),
];

test("a query finds the passage about the same thing without sharing its words", async () => {
  const index = new SemanticIndex(new TopicEmbedder());
  await index.build(CORPUS);

  const hits = await index.search("how do they handle positions in a sequence", 3);
  assert.equal(hits[0]!.id, "note:a");
});

test("an empty corpus leaves the index unbuilt rather than empty-but-ready", async () => {
  const index = new SemanticIndex(new TopicEmbedder());
  await index.build([]);
  assert.equal(index.ready, false);
  assert.deepEqual(await index.search("anything"), []);
});

test("a blank query returns nothing instead of a nearest-to-nothing list", async () => {
  const index = new SemanticIndex(new TopicEmbedder());
  await index.build(CORPUS);
  assert.deepEqual(await index.search("   "), []);
});

test("a long document is embedded in passages, not truncated to its first", async () => {
  const embedder = new TopicEmbedder();
  const index = new SemanticIndex(embedder);
  const long = doc(
    "note:long",
    "Everything",
    `${"The transformer weighs positions. ".repeat(40)}\n\n${"The autoencoder learns a latent posterior. ".repeat(40)}`,
  );

  await index.build([long]);

  assert.ok(index.size > 1, "one document became several passages");
  // The tail of the document is findable, which truncation would have lost.
  const hits = await index.search("latent posterior", 1);
  assert.equal(hits[0]!.id, "note:long");
});

test("passages collapse back to one hit per document", async () => {
  const index = new SemanticIndex(new TopicEmbedder());
  await index.build([
    doc("note:long", "Everything", "The transformer weighs positions. ".repeat(60)),
  ]);

  const hits = await index.search("transformer positions", 10);
  assert.equal(hits.length, 1, "a document appears once, however many passages matched");
  assert.equal(hits[0]!.id, "note:long");
});

test("passage ids carry their document", () => {
  assert.equal(documentIdOf("note:a#3"), "note:a");
  assert.equal(documentIdOf("note:a"), "note:a", "an unsuffixed id is its own document");
  assert.equal(documentIdOf("pdf:p1:12#0"), "pdf:p1:12", "only the last # is the passage marker");
});

test("queries and passages are embedded under their own role", async () => {
  const embedder = new TopicEmbedder();
  const index = new SemanticIndex(embedder);
  await index.build(CORPUS);
  await index.search("transformer");

  assert.ok(embedder.calls.some((call) => call.kind === "passage"));
  assert.equal(embedder.calls[embedder.calls.length - 1]!.kind, "query");
});

test("updating a document replaces its passages rather than adding to them", async () => {
  const index = new SemanticIndex(new TopicEmbedder());
  await index.build(CORPUS);
  const before = index.size;

  await index.update([doc("note:a", "Method", "We now use Adam and momentum instead.")]);

  assert.equal(index.size, before, "the passage count is unchanged for a same-length rewrite");
  const hits = await index.search("adam momentum gradient", 3);
  assert.equal(hits[0]!.id, "note:a", "the new text is what is searched");
});

test("a rewrite that shortens a document does not leave its old tail behind", async () => {
  const index = new SemanticIndex(new TopicEmbedder());
  const long = doc("note:x", "Long", "The transformer weighs positions. ".repeat(80));
  await index.build([long]);
  assert.ok(index.size > 2);

  await index.update([doc("note:x", "Long", "Short now.")]);
  assert.equal(index.size, 1, "every former passage was retracted");
});

test("removing a document removes all of its passages", async () => {
  const index = new SemanticIndex(new TopicEmbedder());
  await index.build([doc("note:x", "Long", "The transformer weighs positions. ".repeat(80))]);

  index.removeDocuments(["note:x"]);
  assert.equal(index.size, 0);
  assert.deepEqual(await index.search("transformer"), []);
});

test("vectors survive a round trip through storage", async () => {
  const index = new SemanticIndex(new TopicEmbedder());
  await index.build(CORPUS);
  const packed = index.serialize();
  assert.ok(packed);

  const restored = new SemanticIndex(new TopicEmbedder());
  assert.equal(restored.load(packed), true);
  assert.equal(restored.size, index.size);
  assert.equal((await restored.search("positions in a sequence", 1))[0]!.id, "note:a");
});

test("vectors from another model are refused, not reinterpreted", async () => {
  const index = new SemanticIndex(new TopicEmbedder());
  await index.build(CORPUS);
  const packed = index.serialize()!;

  const other = new SemanticIndex(new TopicEmbedder());
  assert.equal(
    other.load({ ...packed, model: "some-other-encoder" }),
    false,
    "a different encoder's vectors are meaningless here, not merely stale",
  );
  assert.equal(other.ready, false);
});

test("stored data of the wrong width is refused rather than crashing", async () => {
  const index = new SemanticIndex(new TopicEmbedder());
  await index.build(CORPUS);
  const packed = index.serialize()!;

  const other = new SemanticIndex(new TopicEmbedder());
  assert.equal(other.load({ ...packed, dimensions: 7 }), false);
});

test("building reports progress so a long pass can be shown", async () => {
  const seen: number[] = [];
  const index = new SemanticIndex(new TopicEmbedder());
  const many = Array.from({ length: 40 }, (_, i) =>
    doc(`note:${i}`, `Note ${i}`, "The transformer weighs positions."),
  );

  await index.build(many, { onProgress: (p) => seen.push(p.done) });

  assert.ok(seen.length > 1, "progress is reported per batch");
  assert.equal(seen[seen.length - 1], 40, "the last report is the total");
});

test("an aborted build stops instead of finishing in the background", async () => {
  const controller = new AbortController();
  const index = new SemanticIndex(new TopicEmbedder());
  const many = Array.from({ length: 200 }, (_, i) =>
    doc(`note:${i}`, `Note ${i}`, "The transformer weighs positions."),
  );

  const build = index.build(many, {
    signal: controller.signal,
    onProgress: () => controller.abort(),
  });

  await assert.rejects(build, /cancelled/i);
  assert.equal(index.ready, false, "a half-built index is not exposed");
});

test("sync re-embeds only what changed and drops what was deleted", async () => {
  const embedder = new TopicEmbedder();
  const index = new SemanticIndex(embedder);
  await index.build(CORPUS);
  embedder.calls = [];

  const edited = doc("note:a", "Method", "We train the autoencoder latent with Adam.");
  const changed = await index.sync([edited, CORPUS[2]!], (id) => id.startsWith("note:"));

  assert.equal(changed, true);
  assert.equal(embedder.calls.length, 1, "one edited note, one forward pass");
  assert.equal((await index.search("posterior latent vae", 5)).some((h) => h.id === "note:b"), false, "deleted note is gone");
  assert.equal(await index.sync([edited, CORPUS[2]!], (id) => id.startsWith("note:")), false, "no-op second time");
});

test("nearestTo finds neighbours from the seed's own vectors, without embedding", async () => {
  const embedder = new TopicEmbedder();
  const index = new SemanticIndex(embedder);
  await index.build([...CORPUS, doc("note:d", "Tuesday", "More on self-attention and the transformer.")]);
  embedder.calls = [];

  const near = index.nearestTo("note:d", 3);
  assert.equal(near[0]?.id, "note:a");
  assert.equal(near.some((h) => h.id === "note:d"), false, "never itself");
  assert.equal(embedder.calls.length, 0);
});

test("stored vectors plus hashes re-embed only what changed while the app was closed", async () => {
  const first = new SemanticIndex(new TopicEmbedder());
  await first.build(CORPUS);
  const stored = first.serialize()!;
  assert.ok(stored.hashes["note:a"], "each document's text hash travels with the vectors");

  // Next launch: one note edited, one deleted, one added.
  const edited = doc("note:a", "Method", "Adam with momentum, now about the optimizer.");
  const added = doc("note:d", "More", "A latent autoencoder variant.");
  const now = [edited, CORPUS[1]!, added];

  const embedder = new TopicEmbedder();
  const second = new SemanticIndex(embedder);
  assert.equal(second.load(stored), true);
  const changed = await second.sync(now, () => true);

  assert.equal(changed, true);
  const embedded = embedder.calls.filter((call) => call.kind === "passage").flatMap((call) => call.texts);
  assert.equal(embedded.length, 2, "the edited and the added note, nothing else");
  assert.ok(embedded.some((text) => text.includes("optimizer")));
  assert.ok(embedded.some((text) => text.includes("variant")));

  const ids = (await second.search("adam gradient", 5)).map((hit) => hit.id);
  assert.ok(!ids.includes("note:c"), "the deleted note no longer answers");
  assert.equal(ids[0], "note:a", "the edited note is found by its new meaning");
});

test("a reload with nothing changed embeds nothing", async () => {
  const first = new SemanticIndex(new TopicEmbedder());
  await first.build(CORPUS);
  const embedder = new TopicEmbedder();
  const second = new SemanticIndex(embedder);
  second.load(first.serialize()!);
  assert.equal(await second.sync(CORPUS, () => true), false);
  assert.equal(embedder.calls.length, 0);
});
