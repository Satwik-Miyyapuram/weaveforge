import assert from "node:assert/strict";
import test from "node:test";
import {
  RRF_K,
  VectorDimensionError,
  VectorIndex,
  chunkForEmbedding,
  fuseRankings,
  normalizeVector,
} from "../src/index.js";

const v = (...values: number[]) => Float32Array.from(values);

// ---------------------------------------------------------------- normalize

test("normalizing makes cosine a dot product", () => {
  const unit = normalizeVector(v(3, 4));
  assert.ok(Math.abs(unit[0]! - 0.6) < 1e-6);
  assert.ok(Math.abs(unit[1]! - 0.8) < 1e-6);
});

test("a zero vector normalizes to itself rather than to NaN", () => {
  const zero = normalizeVector(v(0, 0, 0));
  assert.deepEqual([...zero], [0, 0, 0]);
});

// ------------------------------------------------------------- vector index

test("the nearest vector ranks first", () => {
  const index = new VectorIndex(2);
  index.add([
    { id: "east", vector: v(1, 0) },
    { id: "north", vector: v(0, 1) },
    { id: "north-east", vector: v(1, 1) },
  ]);

  const hits = index.search(v(1, 0.1), 3, -1);
  assert.deepEqual(hits.map((h) => h.id), ["east", "north-east", "north"]);
  assert.ok(hits[0]!.score > 0.99);
});

test("magnitude does not decide the ranking, direction does", () => {
  const index = new VectorIndex(2);
  index.add([
    { id: "small", vector: v(0.01, 0) },
    { id: "large-but-off", vector: v(100, 100) },
  ]);

  assert.equal(index.search(v(1, 0), 1, -1)[0]!.id, "small");
});

test("weak matches are dropped rather than padding the list", () => {
  const index = new VectorIndex(2);
  index.add([
    { id: "aligned", vector: v(1, 0) },
    { id: "orthogonal", vector: v(0, 1) },
  ]);

  const hits = index.search(v(1, 0), 10, 0.2);
  assert.deepEqual(hits.map((h) => h.id), ["aligned"]);
});

test("re-adding an id replaces its vector instead of duplicating it", () => {
  const index = new VectorIndex(2);
  index.add([{ id: "a", vector: v(1, 0) }]);
  index.add([{ id: "a", vector: v(0, 1) }]);

  assert.equal(index.size, 1);
  assert.deepEqual(index.search(v(0, 1), 1, -1)[0]!.id, "a");
  assert.ok(index.search(v(0, 1), 1, -1)[0]!.score > 0.99, "the new vector is what is stored");
});

test("removing one entry leaves the others findable", () => {
  const index = new VectorIndex(2);
  index.add([
    { id: "a", vector: v(1, 0) },
    { id: "b", vector: v(0, 1) },
    { id: "c", vector: v(1, 1) },
  ]);

  index.remove(["a"]);

  assert.equal(index.size, 2);
  assert.equal(index.has("a"), false);
  assert.deepEqual(index.allIds().sort(), ["b", "c"]);
  // The swap-with-last removal must not corrupt the moved vector.
  assert.ok(index.search(v(0, 1), 1, -1)[0]!.score > 0.99);
});

test("removing the last entry is not a special case", () => {
  const index = new VectorIndex(2);
  index.add([{ id: "a", vector: v(1, 0) }, { id: "b", vector: v(0, 1) }]);
  index.remove(["b"]);
  assert.deepEqual(index.allIds(), ["a"]);
  index.remove(["a"]);
  assert.equal(index.size, 0);
  assert.deepEqual(index.search(v(1, 0), 5, -1), []);
});

test("removing an id that is not there is a no-op", () => {
  const index = new VectorIndex(2);
  index.add([{ id: "a", vector: v(1, 0) }]);
  index.remove(["nope"]);
  assert.equal(index.size, 1);
});

test("growing past the initial capacity keeps every vector intact", () => {
  const index = new VectorIndex(2, 2);
  for (let i = 0; i < 50; i += 1) {
    index.add([{ id: `id${i}`, vector: v(Math.cos(i), Math.sin(i)) }]);
  }

  assert.equal(index.size, 50);
  const hit = index.search(v(Math.cos(37), Math.sin(37)), 1, -1)[0]!;
  assert.equal(hit.id, "id37");
});

test("a vector of the wrong width is refused, not silently truncated", () => {
  const index = new VectorIndex(3);
  assert.throws(() => index.add([{ id: "a", vector: v(1, 0) }]), VectorDimensionError);
  index.add([{ id: "a", vector: v(1, 0, 0) }]);
  assert.throws(() => index.search(v(1, 0)), VectorDimensionError);
});

test("an index survives a round trip through storage", () => {
  const index = new VectorIndex(3);
  index.add([
    { id: "a", vector: v(1, 0, 0) },
    { id: "b", vector: v(0, 1, 0) },
  ]);

  const { ids, vectors } = index.toBytes();
  const restored = VectorIndex.fromBytes(3, ids, vectors);

  assert.equal(restored.size, 2);
  assert.equal(restored.search(v(0, 1, 0), 1, -1)[0]!.id, "b");
});

test("stored data written for another width is rejected, not reinterpreted", () => {
  const index = new VectorIndex(4);
  index.add([{ id: "a", vector: v(1, 0, 0, 0) }]);
  const { ids, vectors } = index.toBytes();

  assert.throws(() => VectorIndex.fromBytes(3, ids, vectors), VectorDimensionError);
});

// ------------------------------------------------------------------ chunking

test("text that fits an encoder is one passage", () => {
  const chunks = chunkForEmbedding("A short note about attention.");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.text, "A short note about attention.");
});

test("empty or blank text produces no passages", () => {
  assert.deepEqual(chunkForEmbedding(""), []);
  assert.deepEqual(chunkForEmbedding("   \n  "), []);
});

test("long text is split, and every passage fits the window", () => {
  const paragraph = "Attention weights every position against every other. ".repeat(80);
  const chunks = chunkForEmbedding(paragraph, { maxChars: 400 });

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.text.length <= 400, `${chunk.text.length} > 400`);
});

test("passages overlap, so a sentence on a boundary survives in one of them", () => {
  const text = `${"a".repeat(380)}. The reparameterisation trick makes it tractable. ${"b".repeat(380)}`;
  const chunks = chunkForEmbedding(text, { maxChars: 400, overlapChars: 120 });

  assert.ok(
    chunks.some((chunk) => chunk.text.includes("reparameterisation trick makes it tractable")),
    "the boundary sentence is whole somewhere",
  );
});

test("splits prefer paragraph breaks over cutting mid-sentence", () => {
  const text = `${"First paragraph. ".repeat(15)}\n\n${"Second paragraph. ".repeat(15)}`;
  const chunks = chunkForEmbedding(text, { maxChars: 300, overlapChars: 0 });

  assert.ok(chunks[0]!.text.endsWith("."), "a passage ends where a thought does");
});

test("text with no boundaries at all still terminates", () => {
  const chunks = chunkForEmbedding("x".repeat(5_000), { maxChars: 400 });
  assert.ok(chunks.length >= 12);
  for (const chunk of chunks) assert.ok(chunk.text.length <= 400);
});

test("a trailing scrap is folded into its neighbour rather than embedded alone", () => {
  const text = `${"word ".repeat(200)}end.`;
  const chunks = chunkForEmbedding(text, { maxChars: 400, overlapChars: 0, minChars: 80 });
  assert.ok(chunks[chunks.length - 1]!.text.length >= 80);
});

test("offsets point back into the source", () => {
  const text = "Attention. ".repeat(120);
  for (const chunk of chunkForEmbedding(text, { maxChars: 300 })) {
    assert.ok(text.slice(chunk.start, chunk.end).includes(chunk.text.slice(0, 20)));
  }
});

// ------------------------------------------------------------- rank fusion

const id = (x: { id: string }) => x.id;

test("a document both arms rank outranks one only a single arm found", () => {
  const keyword = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const vectors = [{ id: "c" }, { id: "d" }, { id: "a" }];

  const fused = fuseRankings([{ items: keyword }, { items: vectors }], id);
  assert.equal(fused[0]!.id, "a", "first in one list and third in the other beats first in one");
  assert.ok(fused.findIndex((x) => x.id === "c") < fused.findIndex((x) => x.id === "d"));
});

test("a document only one arm found still appears", () => {
  const fused = fuseRankings([{ items: [{ id: "a" }] }, { items: [{ id: "b" }] }], id);
  assert.deepEqual(fused.map(id).sort(), ["a", "b"]);
});

test("the first list supplies the object, so excerpts survive fusion", () => {
  const keyword = [{ id: "a", excerpt: "…matched here…" }];
  const vectors = [{ id: "a", excerpt: undefined }];

  const fused = fuseRankings<{ id: string; excerpt?: string }>(
    [{ items: keyword }, { items: vectors }],
    id,
  );
  assert.equal(fused[0]!.excerpt, "…matched here…");
});

test("weighting shifts the balance without needing score calibration", () => {
  const keyword = [{ id: "k" }, { id: "shared" }];
  const vectors = [{ id: "v" }, { id: "shared" }];

  const keywordHeavy = fuseRankings([{ items: keyword, weight: 4 }, { items: vectors }], id).map(id);
  const vectorHeavy = fuseRankings([{ items: keyword }, { items: vectors, weight: 4 }], id).map(id);

  // `shared` leads both: it is in both lists, which is the whole point. What
  // the weight decides is which arm's exclusive find comes next.
  assert.equal(keywordHeavy[0], "shared");
  assert.ok(keywordHeavy.indexOf("k") < keywordHeavy.indexOf("v"));
  assert.ok(vectorHeavy.indexOf("v") < vectorHeavy.indexOf("k"));
});

test("fusing one list preserves its order", () => {
  const only = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(fuseRankings([{ items: only }], id).map(id), ["a", "b", "c"]);
});

test("an empty arm does not disturb the other", () => {
  const keyword = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(fuseRankings([{ items: keyword }, { items: [] }], id).map(id), ["a", "b"]);
});

test("the limit is applied after fusion, not before", () => {
  const keyword = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const vectors = [{ id: "c" }, { id: "c2" }];

  const fused = fuseRankings([{ items: keyword }, { items: vectors }], id, { limit: 2 });
  assert.equal(fused.length, 2);
  assert.ok(fused.some((x) => x.id === "c"), "a document lifted by both arms makes the cut");
});

test("the rank constant flattens the top of each list", () => {
  // With k = 60, being first rather than second is a small edge; with k = 0 it
  // is a large one. The default exists so one confident arm cannot dominate.
  const lists = [{ items: [{ id: "first" }, { id: "second" }] }];
  const flat = fuseRankings(lists, id, { k: RRF_K });
  const sharp = fuseRankings(lists, id, { k: 0 });
  assert.deepEqual(flat.map(id), sharp.map(id), "order is the same; the margin is not");
});
