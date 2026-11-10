import assert from "node:assert/strict";
import test, { before } from "node:test";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

// "Café" yields its original and folded token, both "cafe" after processing,
// as the TS tokenizer did, so term frequency is unchanged. Compare as sets.
test("an accented query and unaccented text produce the same term", () => {
  assert.deepEqual([...new Set(readyCore().indexTermsOf("Café"))], ["cafe"]);
  assert.deepEqual([...new Set(readyCore().indexTermsOf("cafe"))], ["cafe"]);
});

test("camelCase and URLs are split into findable parts", () => {
  const terms = readyCore().indexTermsOf("parseHTTPResponse see https://arxiv.org/abs/2305.12345");
  for (const x of ["parsehttpresponse", "parse", "arxiv"]) {
    assert.ok(terms.includes(x), x);
  }
});

test("text over the Rust limit is cut, not rejected", () => {
  const max = readyCore().maxIndexTextUtf16();
  const terms = readyCore().indexTermsOf(`needle ${"x ".repeat(max)} tailword`);
  assert.ok(terms.includes("needle"), "the start of the text is kept");
  assert.ok(!terms.includes("tailword"), "the text past the cap is dropped");
});

test("an excerpt of a body over the Rust limit is cut, not rejected", () => {
  const max = readyCore().maxIndexTextUtf16();
  const body = `needle ${"x ".repeat(max)}`;
  const excerpt = readyCore().excerptOf(body, ["needle"]);
  assert.ok(excerpt.text.includes("needle"));
});

test("an excerpt whose terms alone exceed the limit throws", () => {
  // Mirrors the TS buildExcerpt guard: each term costs its length + 1 units.
  const max = readyCore().maxIndexTextUtf16();
  assert.throws(() => readyCore().excerptOf("body", ["a".repeat(max)]), /MAX_INDEX_TEXT_UTF16/);
});
