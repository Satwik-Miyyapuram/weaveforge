import assert from "node:assert/strict";
import test from "node:test";
import { urlParts } from "../../src/search/search-tokenizer.js";

const OLD_URL_RE = /https?:\/\/\S+|\S+\.(?:com|org|net|edu|io|ai|dev|gov)\b\S*/gi;

function referenceUrlParts(text: string): string[] {
  const out: string[] = [];
  for (const match of text.match(OLD_URL_RE) ?? []) {
    for (const part of match.split(/[^\p{L}\p{N}]+/u)) {
      if (part.length > 1) out.push(part.toLowerCase());
    }
  }
  return out;
}

test("urlParts matches referenceUrlParts on plain prose", () => {
  const text = "The quick brown fox jumps over the lazy dog in a calm summer afternoon.";
  assert.deepEqual(urlParts(text), referenceUrlParts(text));
});

test("urlParts matches referenceUrlParts on sample arxiv and web URLs", () => {
  const text = "see https://arxiv.org/abs/2305.12345, and www.example.com/x.";
  assert.deepEqual(urlParts(text), referenceUrlParts(text));
});

test("urlParts matches referenceUrlParts on parenthesized URL", () => {
  const text = "(https://a.io)";
  assert.deepEqual(urlParts(text), referenceUrlParts(text));
});

test("urlParts matches referenceUrlParts on concatenated domains", () => {
  const text = "foo.combar.com";
  assert.deepEqual(urlParts(text), referenceUrlParts(text));
});

test("urlParts matches referenceUrlParts on mixed casing", () => {
  const text = "x.COM y.Org";
  assert.deepEqual(urlParts(text), referenceUrlParts(text));
});

test("urlParts matches referenceUrlParts on URLs separated by whitespace escapes", () => {
  const text = "https://example.com/a\thttps://example.org/b\nhttps://example.net/c\u00a0https://example.edu/d\u2003https://example.io/e";
  assert.deepEqual(urlParts(text), referenceUrlParts(text));
});

test("urlParts matches referenceUrlParts on multi-subdomain chain", () => {
  const text = "a.b.c.d.e.f.com.x";
  assert.deepEqual(urlParts(text), referenceUrlParts(text));
});

test("urlParts matches referenceUrlParts on text with no dots", () => {
  const text = "plain text without any periods but maybe http://localhost:8080/path or simple words";
  assert.deepEqual(urlParts(text), referenceUrlParts(text));
});

test("urlParts matches referenceUrlParts on empty string", () => {
  const text = "";
  assert.deepEqual(urlParts(text), referenceUrlParts(text));
});

test("urlParts matches referenceUrlParts on generated 200 kB text", () => {
  const tokens = [
    "regular",
    "word",
    "punctuation,",
    "parenthesis(test)",
    "https://arxiv.org/abs/2305.12345",
    "www.example.com/path",
    "(https://a.io)",
    "foo.combar.com",
    "x.COM",
    "y.Org",
    "a.b.c.d.e.f.com.x",
    "some.subdomain.net/query?param=1&other=2",
    "end.",
  ];

  let seed = 123456789;
  const parts: string[] = [];
  let totalLength = 0;
  const targetLength = 200 * 1024;

  while (totalLength < targetLength) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const word = tokens[seed % tokens.length]!;
    parts.push(word);
    totalLength += word.length + 1;
  }

  const generated = parts.join(" ");
  assert.ok(generated.length >= targetLength);
  assert.deepEqual(urlParts(generated), referenceUrlParts(generated));
});
