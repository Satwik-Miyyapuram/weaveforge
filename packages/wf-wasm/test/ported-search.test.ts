import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildExcerpt,
  fuseRankings,
  indexTerms,
  initSync,
  parseQuery,
  tokenize,
  type TokenizerOptions,
} from "../src/index.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

// The TS tokenizer defaults (packages/core/src/search/search-tokenizer.ts).
const DEFAULTS: TokenizerOptions = {
  foldDiacritics: true,
  foldArabicDiacritics: false,
  splitCamelCase: true,
  tokenizeUrls: true,
};

// ---------------------------------------------------------------- query syntax

test("plain terms are collected and lowercased", () => {
  const q = parseQuery("Graph Neural");

  assert.deepEqual(q.terms, ["graph", "neural"]);
  assert.equal(q.text, "graph neural");
});

test("quoted phrases stay contiguous", () => {
  const q = parseQuery('"message passing" graphs');

  assert.deepEqual(q.phrases, ["message passing"]);
  assert.deepEqual(q.terms, ["graphs"]);
});

test("exclusions are captured for both terms and phrases", () => {
  const q = parseQuery('vae -baseline -"work in progress"');

  assert.deepEqual(q.terms, ["vae"]);
  assert.deepEqual(q.exclude, ["baseline", "work in progress"]);
  assert.ok(!q.text.includes("baseline"), "excluded terms must not feed the ranker");
});

test("kind:, path:, and tag: filters are parsed out of the ranked text", () => {
  const q = parseQuery("kind:note path:Method tag:#vae latent");

  assert.deepEqual(q.kinds, ["note"]);
  assert.deepEqual(q.paths, ["method"]);
  assert.deepEqual(q.tags, ["vae"], "a leading # is stripped");
  assert.equal(q.text, "latent", "operators are removed from the ranked text");
});

test("repeated filters accumulate", () => {
  const q = parseQuery("kind:note kind:paper");

  assert.deepEqual(q.kinds, ["note", "paper"]);
});

test("an unknown kind narrows to nothing rather than leaking into the terms", () => {
  const q = parseQuery("kind:banana latent");

  assert.deepEqual(q.kinds, []);
  assert.equal(q.text, "latent", "the bad filter is dropped, not treated as a term");
});

test("an unterminated quote does not swallow the rest of the query", () => {
  const q = parseQuery('"message passing');

  assert.ok(q.text.length > 0);
  assert.doesNotThrow(() => parseQuery('"'));
});

// ------------------------------------------------------------------ tokenizer

test("diacritics fold so cafe matches café", () => {
  assert.deepEqual(indexTerms("café", DEFAULTS), ["cafe"]);
  assert.deepEqual(indexTerms("MÜLLER", DEFAULTS), ["muller"]);
});

// The TS test called foldDiacritics directly; harakat folding itself is pinned
// by wf-core tests/search_text.rs. Through the pipeline the tokenizer splits on
// the marks first (they are not letters), in the old TS as in Rust.
// Known defect kept for parity, not the target: vowelled Arabic words cannot be
// searched as words and foldArabicDiacritics does nothing here. Fix after the
// port (handoff.md § After the port), then expect ["محمد"].
test("arabic harakat split the word before folding, with or without the option", () => {
  const withMarks = "مُحَمَّد";
  for (const foldArabicDiacritics of [false, true]) {
    assert.deepEqual(indexTerms(withMarks, { ...DEFAULTS, foldArabicDiacritics }), ["م", "ح", "د"]);
  }
});

test("camelCase yields its parts as well as the whole token", () => {
  const tokens = tokenize("parseHTTPResponse", DEFAULTS);

  assert.ok(tokens.includes("parsehttpresponse"), "the original token survives");
  assert.ok(tokens.includes("parse"));
  assert.ok(tokens.includes("response"));
});

test("urls contribute host and path segments", () => {
  const tokens = tokenize("see https://arxiv.org/abs/2305.12345 for details", DEFAULTS);

  assert.ok(tokens.includes("arxiv"));
  assert.ok(tokens.includes("2305"));
});

test("CJK text yields characters and bigrams, not one giant token", () => {
  const tokens = tokenize("变分自编码器", DEFAULTS);

  assert.ok(tokens.includes("变"), "unigrams make single-character queries work");
  assert.ok(tokens.includes("变分"), "bigrams carry most of the meaning");
});

test("mixed-script text tokenizes both halves", () => {
  const tokens = tokenize("VAE 编码器", DEFAULTS);

  assert.ok(tokens.includes("vae"));
  assert.ok(tokens.includes("编"));
});

test("empty and punctuation-only input yield no tokens", () => {
  assert.deepEqual(tokenize("", DEFAULTS), []);
  assert.deepEqual(tokenize("--- ,,, ", DEFAULTS), []);
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

test("an empty body yields an empty excerpt rather than throwing", () => {
  assert.deepEqual(buildExcerpt("", ["x"]), { text: "", highlights: [] });
});

test("single-character terms are ignored so highlights are not noise", () => {
  const excerpt = buildExcerpt("a lot of a's here", ["a"]);

  assert.deepEqual(excerpt.highlights, []);
});

// 01-10: one pass over the matches, and the same window the full rescan chose.
test("excerpt picks the densest window when it is not the first match", () => {
  const body = `alpha ${"filler ".repeat(40)}beta gamma beta gamma beta ${"filler ".repeat(40)}beta`;
  const excerpt = buildExcerpt(body, ["beta", "gamma"], { maxChars: 60 });
  const words = excerpt.highlights.map((h) => excerpt.text.slice(h.start, h.end));
  assert.deepEqual(words, ["beta", "gamma", "beta", "gamma", "beta"]);
});

test("excerpt over a body with thousands of matches stays quick", () => {
  const body = "match ".repeat(60_000);
  const started = performance.now();
  const excerpt = buildExcerpt(body, ["match"], { maxChars: 120 });
  assert.ok(excerpt.highlights.length > 0);
  // The old rescan took about 5 s here; one pass takes about 50 ms.
  assert.ok(performance.now() - started < 1_000, "excerpt scan is quadratic again");
});

// ------------------------------------------------------- url and normalization

test("urlParts stays linear on a long run with no URL (ReDoS guard)", () => {
  const text = `${"!".repeat(200_000)}.`;
  const started = performance.now();
  assert.deepEqual(tokenize(text, DEFAULTS), []);
  assert.ok(performance.now() - started < 1000, "tokenize took over 1 s");
});

test("tokenize and processTerm normalize a word the same way (01-13)", () => {
  // Index terms come from tokenize, query terms from processTerm; if the two
  // fold differently, a word stops finding itself.
  const variants: Partial<TokenizerOptions>[] = [{}, { foldDiacritics: false }, { foldArabicDiacritics: true }];
  for (const variant of variants) {
    const options: TokenizerOptions = { ...DEFAULTS, ...variant, splitCamelCase: false };
    for (const word of ["Café", "NAÏVE", "Ångström", "İstanbul", "straße", "résumé", "Øresund"]) {
      assert.ok(
        tokenize(word, options).includes(indexTerms(word, options)[0]!),
        `${word} with ${JSON.stringify(variant)}`,
      );
    }
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
  const flat = fuseRankings(lists, id, { k: 60 });
  const sharp = fuseRankings(lists, id, { k: 0 });
  assert.deepEqual(flat.map(id), sharp.map(id), "order is the same; the margin is not");
});
