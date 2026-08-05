import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExcerpt,
  excerptSegments,
  foldDiacritics,
  isEmptyQuery,
  isFilterOnly,
  parseSearchQuery,
  processTerm,
  tokenize,
} from "../src/index.js";

// ---------------------------------------------------------------- query syntax

test("plain terms are collected and lowercased", () => {
  const q = parseSearchQuery("Graph Neural");

  assert.deepEqual(q.terms, ["graph", "neural"]);
  assert.equal(q.text, "graph neural");
});

test("quoted phrases stay contiguous", () => {
  const q = parseSearchQuery('"message passing" graphs');

  assert.deepEqual(q.phrases, ["message passing"]);
  assert.deepEqual(q.terms, ["graphs"]);
});

test("exclusions are captured for both terms and phrases", () => {
  const q = parseSearchQuery('vae -baseline -"work in progress"');

  assert.deepEqual(q.terms, ["vae"]);
  assert.deepEqual(q.exclude, ["baseline", "work in progress"]);
  assert.ok(!q.text.includes("baseline"), "excluded terms must not feed the ranker");
});

test("kind:, path:, and tag: filters are parsed out of the ranked text", () => {
  const q = parseSearchQuery("kind:note path:Method tag:#vae latent");

  assert.deepEqual(q.kinds, ["note"]);
  assert.deepEqual(q.paths, ["method"]);
  assert.deepEqual(q.tags, ["vae"], "a leading # is stripped");
  assert.equal(q.text, "latent", "operators are removed from the ranked text");
});

test("repeated filters accumulate", () => {
  const q = parseSearchQuery("kind:note kind:paper");

  assert.deepEqual(q.kinds, ["note", "paper"]);
});

test("an unknown kind narrows to nothing rather than leaking into the terms", () => {
  const q = parseSearchQuery("kind:banana latent");

  assert.deepEqual(q.kinds, []);
  assert.equal(q.text, "latent", "the bad filter is dropped, not treated as a term");
});

test("an unterminated quote does not swallow the rest of the query", () => {
  const q = parseSearchQuery('"message passing');

  assert.ok(q.text.length > 0);
  assert.doesNotThrow(() => parseSearchQuery('"'));
});

test("filter-only and empty queries are distinguishable", () => {
  assert.ok(isFilterOnly(parseSearchQuery("kind:note")));
  assert.ok(!isEmptyQuery(parseSearchQuery("kind:note")));
  assert.ok(isEmptyQuery(parseSearchQuery("   ")));
  assert.ok(!isFilterOnly(parseSearchQuery("latent")));
});

// ------------------------------------------------------------------ tokenizer

test("diacritics fold so cafe matches café", () => {
  assert.equal(foldDiacritics("café"), "cafe");
  assert.equal(processTerm("MÜLLER"), "muller");
});

test("arabic harakat fold only when asked", () => {
  const withMarks = "مُحَمَّد";
  assert.notEqual(foldDiacritics(withMarks, false), "محمد");
  assert.equal(foldDiacritics(withMarks, true), "محمد");
});

test("camelCase yields its parts as well as the whole token", () => {
  const tokens = tokenize("parseHTTPResponse");

  assert.ok(tokens.includes("parsehttpresponse"), "the original token survives");
  assert.ok(tokens.includes("parse"));
  assert.ok(tokens.includes("response"));
});

test("urls contribute host and path segments", () => {
  const tokens = tokenize("see https://arxiv.org/abs/2305.12345 for details");

  assert.ok(tokens.includes("arxiv"));
  assert.ok(tokens.includes("2305"));
});

test("CJK text yields characters and bigrams, not one giant token", () => {
  const tokens = tokenize("变分自编码器");

  assert.ok(tokens.includes("变"), "unigrams make single-character queries work");
  assert.ok(tokens.includes("变分"), "bigrams carry most of the meaning");
});

test("mixed-script text tokenizes both halves", () => {
  const tokens = tokenize("VAE 编码器");

  assert.ok(tokens.includes("vae"));
  assert.ok(tokens.includes("编"));
});

test("empty and punctuation-only input yield no tokens", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize("--- ,,, "), []);
});

// -------------------------------------------------------------------- excerpts

const BODY =
  "Intro text that is fairly long and unrelated. " +
  "We compare the baseline against the latent model. " +
  "The latent model and the latent prior both improve results. " +
  "Closing remarks that go on for a while afterwards.";

test("excerpt centres on the densest cluster of matches", () => {
  const excerpt = buildExcerpt(BODY, ["latent"], { maxChars: 80 });

  // Three "latent" hits sit together in the third sentence; a naive
  // first-match-wins excerpt would show only the one in the second.
  assert.ok(excerpt.highlights.length >= 2, "should capture the cluster, not the first hit");
  assert.match(excerpt.text, /latent/);
});

test("highlight offsets index into the returned snippet", () => {
  const excerpt = buildExcerpt(BODY, ["baseline"], { maxChars: 60 });

  for (const range of excerpt.highlights) {
    assert.equal(excerpt.text.slice(range.start, range.end).toLowerCase(), "baseline");
  }
});

test("matching is case-insensitive", () => {
  const excerpt = buildExcerpt("The Latent Model", ["latent"]);

  assert.equal(excerpt.highlights.length, 1);
  assert.equal(excerpt.text.slice(excerpt.highlights[0]!.start, excerpt.highlights[0]!.end), "Latent");
});

test("overlapping terms merge into one highlight", () => {
  const excerpt = buildExcerpt("autoencoder", ["auto", "autoenc"]);

  assert.equal(excerpt.highlights.length, 1, "overlapping ranges must not double-wrap");
});

test("no match still returns leading context rather than nothing", () => {
  const excerpt = buildExcerpt(BODY, ["nonexistent"], { maxChars: 40 });

  assert.ok(excerpt.text.length > 0);
  assert.deepEqual(excerpt.highlights, []);
  assert.ok(excerpt.text.endsWith("…"));
});

test("ellipses mark where the snippet was cut", () => {
  const excerpt = buildExcerpt(BODY, ["latent"], { maxChars: 60 });

  assert.ok(excerpt.text.startsWith("…"), "a mid-body window should mark its left cut");
});

test("segments alternate plain and highlighted, covering the whole snippet", () => {
  const excerpt = buildExcerpt("The latent model", ["latent"]);
  const segments = excerptSegments(excerpt);

  assert.equal(segments.map((s) => s.text).join(""), excerpt.text);
  assert.deepEqual(
    segments.filter((s) => s.highlighted).map((s) => s.text),
    ["latent"],
  );
});

test("an empty body yields an empty excerpt rather than throwing", () => {
  assert.deepEqual(buildExcerpt("", ["x"]), { text: "", highlights: [] });
});

test("single-character terms are ignored so highlights are not noise", () => {
  const excerpt = buildExcerpt("a lot of a's here", ["a"]);

  assert.deepEqual(excerpt.highlights, []);
});
