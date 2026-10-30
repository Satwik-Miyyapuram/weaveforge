import assert from "node:assert/strict";
import test, { before } from "node:test";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { excerptOf, indexTermsOf, type SearchCore } from "../infrastructure/search-core";

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

// "Café" yields its original and folded token, both "cafe" after processing,
// as the TS tokenizer did, so term frequency is unchanged. Compare as sets.
test("an accented query and unaccented text produce the same term", () => {
  assert.deepEqual([...new Set(indexTermsOf(core, "Café"))], ["cafe"]);
  assert.deepEqual([...new Set(indexTermsOf(core, "cafe"))], ["cafe"]);
});

test("camelCase and URLs are split into findable parts", () => {
  const terms = indexTermsOf(core, "parseHTTPResponse see https://arxiv.org/abs/2305.12345");
  for (const x of ["parsehttpresponse", "parse", "arxiv"]) {
    assert.ok(terms.includes(x), x);
  }
});

test("text over the Rust limit is cut, not rejected", () => {
  const seen: string[] = [];
  const fake = {
    maxIndexTextUtf16: () => 3,
    indexTerms: (text: string) => {
      seen.push(text);
      return [text];
    },
  } as unknown as SearchCore;
  assert.deepEqual(indexTermsOf(fake, "abcdef"), ["abc"]);
  assert.deepEqual(indexTermsOf(fake, "ab"), ["ab"]);
  assert.deepEqual(seen, ["abc", "ab"]);
});

test("an excerpt of a body over the Rust limit is cut, not rejected", () => {
  const seen: string[] = [];
  const fake = {
    maxIndexTextUtf16: () => 3,
    buildExcerpt: (body: string) => {
      seen.push(body);
      return { text: body, highlights: [] };
    },
  } as unknown as SearchCore;
  assert.deepEqual(excerptOf(fake, "abcdef", ["a"]), { text: "abc", highlights: [] });
  assert.deepEqual(excerptOf(fake, "ab", ["a"]), { text: "ab", highlights: [] });
  assert.deepEqual(seen, ["abc", "ab"]);
});

test("an excerpt of a body far over the limit still builds with the real core", () => {
  const body = `needle ${"x ".repeat(core.maxIndexTextUtf16())}`;
  const excerpt = excerptOf(core, body, ["needle"]);
  assert.ok(excerpt.text.includes("needle"));
});
