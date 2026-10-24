import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { chunkForEmbedding } from "../../src/index.js";

/**
 * Passage ids are `docId#i` and their vectors are stored, so a boundary that
 * moves means every document is embedded again. These pin the boundaries the
 * chunker gives today (01-03).
 */

function corpus(): string {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const words = ["alpha", "beta", "transformer", "attention", "x", "results.", "Why?", "yes!", "e.g.", "data"];
  const seps = [" ", " ", " ", "  ", "\n", "\n\n", "\n \n", "\t", ". ", "\n\n\n", "\n  \n\n"];
  let out = "";
  while (out.length < 40_000) out += words[Math.floor(rnd() * words.length)]! + seps[Math.floor(rnd() * seps.length)]!;
  return out + "end".repeat(400);
}

const digest = (chunks: { start: number; end: number }[]) =>
  createHash("sha256")
    .update(JSON.stringify(chunks.map((c) => [c.start, c.end])))
    .digest("hex");

test("chunk boundaries of a long mixed text stay where they were", () => {
  const chunks = chunkForEmbedding(corpus());
  assert.equal(chunks.length, GOLDEN_COUNT);
  assert.equal(digest(chunks), GOLDEN_DIGEST);
});

test("chunk boundaries with a smaller window stay where they were", () => {
  const chunks = chunkForEmbedding(corpus(), { maxChars: 300, overlapChars: 40 });
  assert.equal(digest(chunks), GOLDEN_SMALL_DIGEST);
});

test("minChars is honoured when choosing a boundary, not only for the last scrap", () => {
  // The only paragraph break sits 50 characters in. With the default minimum
  // (80) it is too early; asking for 20 makes it a valid cut.
  const text = `${"a".repeat(49)}\n\n${"b ".repeat(200)}`;
  const strict = chunkForEmbedding(text, { maxChars: 200, overlapChars: 0 });
  const loose = chunkForEmbedding(text, { maxChars: 200, overlapChars: 0, minChars: 20 });
  assert.notEqual(strict[0]!.end, 51);
  assert.equal(loose[0]!.end, 51);
  assert.equal(loose[0]!.text, "a".repeat(49));
});

test("a long text with no whitespace is still cut into windows", () => {
  const chunks = chunkForEmbedding("z".repeat(2_500));
  assert.deepEqual(
    chunks.map((c) => [c.start, c.end]),
    [
      [0, 1000],
      [880, 1880],
      [1760, 2500],
    ],
  );
});

const GOLDEN_COUNT = 89;
const GOLDEN_DIGEST = "5d506033c7ad70d7f1210be082966eabcdad9fe71bf7ca29ecfd6b163804939d";
const GOLDEN_SMALL_DIGEST = "f841ee436f4b6629195cd76e0a7bdeb9640dd87c622fa740d775f9233cf75c28";
