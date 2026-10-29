import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildExcerpt,
  coreInfo,
  fuseRankings,
  indexTerms,
  initSync,
  maxFusionIds,
  maxIndexTextUtf16,
  parseQuery,
  tokenize,
  type ParsedQuery,
  type TokenizerOptions,
} from "../src/index.js";
import { buildExcerpt as rawBuildExcerpt, fuseRankings as rawFuseRankings } from "../pkg/wf_wasm.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

const read = (url: URL) => readFileSync(url, "utf8");

test("coreInfo returns the core crate version", () => {
  const cargo = read(new URL("../../../Cargo.toml", import.meta.url));
  const version = cargo.match(/^version = "([^"]+)"/m)?.[1];
  assert.ok(version, "Cargo.toml has no workspace version");
  assert.deepEqual(coreInfo(), { version });
});

test("index.ts declares no types of its own", () => {
  // Every type comes from bindings.ts, which wf-bindings generates from Rust,
  // so a type cannot drift from its Rust struct.
  const src = read(new URL("../src/index.ts", import.meta.url));
  assert.doesNotMatch(src, /^\s*(export\s+)?(type|interface)\s+\w+/m);
});

test("every raw wasm export has a typed wrapper", () => {
  // A raw export returns `any`; the wrapper is where it gets its generated type.
  const dts = read(new URL("wf_wasm.d.ts", pkgDir));
  const names = [...dts.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]).filter((n) => n !== "initSync");
  assert.ok(names.length > 0, "found no raw exports in wf_wasm.d.ts");
  const src = read(new URL("../src/index.ts", import.meta.url));
  for (const name of names) {
    assert.match(src, new RegExp(`^export function ${name}(<[^>]*>)?\\(`, "m"), `no typed wrapper for ${name}`);
  }
});

test("wf-wasm exports no classes or enums", () => {
  // A #[wasm_bindgen] struct or enum would bypass the wrapper and bindings.ts.
  // Agree how to type them before adding one.
  const dts = read(new URL("wf_wasm.d.ts", pkgDir));
  assert.doesNotMatch(dts, /^export (declare )?(class|enum) /m);
});

const ALL_ON: TokenizerOptions = {
  foldDiacritics: true,
  foldArabicDiacritics: true,
  splitCamelCase: true,
  tokenizeUrls: true,
};

test("tokenize returns deduplicated lowercase terms", () => {
  assert.deepEqual(tokenize("Hello, World! hello", ALL_ON), ["hello", "world"]);
  assert.deepEqual(tokenize("", ALL_ON), []);
});

test("indexTerms folds each token and keeps duplicates", () => {
  const terms = indexTerms("café myVariable", ALL_ON);
  assert.ok(Array.isArray(terms));
  assert.ok(terms.every((t) => typeof t === "string"));
  assert.deepEqual(terms, ["cafe", "my", "variable", "myvariable"]);
});

test("maxIndexTextUtf16 is the Rust cap", () => {
  assert.equal(maxIndexTextUtf16(), 2 ** 24);
});

test("tokenize and indexTerms reject text over MAX_INDEX_TEXT_UTF16 before WASM", () => {
  // A RangeError comes from the wrapper; the Rust check throws a plain Error.
  // So the text was never copied into linear memory.
  const huge = "a".repeat(2 ** 24 + 1);
  const beforeWasm = (e: unknown) => e instanceof RangeError && /MAX_INDEX_TEXT_UTF16/.test(e.message);
  assert.throws(() => tokenize(huge, ALL_ON), beforeWasm);
  assert.throws(() => indexTerms(huge, ALL_ON), beforeWasm);
});

test("tokenize accepts text at exactly MAX_INDEX_TEXT_UTF16", () => {
  // Multi-byte chars: 2**24 UTF-16 units but 3 * 2**24 UTF-8 bytes, past the fast path.
  assert.equal(tokenize("é".repeat(2 ** 24), ALL_ON).length, 1);
});

test("tokenize rejects malformed options", () => {
  // Extra keys are not rejected: serde-wasm-bindgen reads only the struct's
  // own fields, so deny_unknown_fields never fires. TokenizerOptions is exact in TS.
  const bad = (o: unknown) => () => tokenize("x", o as TokenizerOptions);
  assert.throws(bad({ foldDiacritics: true }), /missing field/);
  assert.throws(bad({ ...ALL_ON, tokenizeUrls: "yes" }));
  assert.throws(bad(undefined));
});

test("parseQuery returns every field, modifiedWithinDays included", () => {
  const q: ParsedQuery = parseQuery('kind:note type:PDF "Deep Dive" -old path:Method in:x tag:#vae modified:2w modified:3d Latent');
  assert.deepEqual(q, {
    terms: ["latent"],
    phrases: ["deep dive"],
    exclude: ["old"],
    kinds: ["note", "pdf"],
    paths: ["method", "x"],
    tags: ["vae"],
    modifiedWithinDays: 3,
    text: "deep dive latent",
  });
});

test("parseQuery gives null, not a missing key, when there is no modified filter", () => {
  const q = parseQuery("");
  assert.ok("modifiedWithinDays" in q);
  assert.equal(q.modifiedWithinDays, null);
  assert.deepEqual(q, { terms: [], phrases: [], exclude: [], kinds: [], paths: [], tags: [], modifiedWithinDays: null, text: "" });
});

test("parseQuery rejects a query over MAX_INDEX_TEXT_UTF16 before WASM", () => {
  const huge = "a".repeat(2 ** 24 + 1);
  assert.throws(() => parseQuery(huge), (e: unknown) => e instanceof RangeError && /MAX_INDEX_TEXT_UTF16/.test(e.message));
});

const self = (id: string) => id;

test("maxFusionIds is 2^20", () => {
  assert.equal(maxFusionIds(), 2 ** 20);
});

test("fuseRankings ranks an id both lists like above one only one list has", () => {
  // a: 1/61 + 1/62, c: 1/63 + 1/61, b: 1/62.
  assert.deepEqual(fuseRankings([{ items: ["a", "b", "c"] }, { items: ["c", "a"] }], self), ["a", "c", "b"]);
  assert.deepEqual(fuseRankings([], self), []);
  assert.deepEqual(fuseRankings([{ items: [] }], self), []);
});

test("fuseRankings returns the item from the first list an id appears in", () => {
  const keyword = [{ id: "x", from: "keyword" }, { id: "y", from: "keyword" }];
  const vector = [{ id: "y", from: "vector" }, { id: "z", from: "vector" }];
  const fused = fuseRankings([{ items: keyword }, { items: vector }], (item) => item.id);
  assert.deepEqual(fused, [
    { id: "y", from: "keyword" },
    { id: "x", from: "keyword" },
    { id: "z", from: "vector" },
  ]);
  assert.equal(fused[0], keyword[1]);
});

test("fuseRankings applies weights, k and limit", () => {
  assert.deepEqual(fuseRankings([{ items: ["x", "y"], weight: 0 }, { items: ["y", "x"] }], self), ["y", "x"]);
  assert.deepEqual(fuseRankings([{ items: ["x", "y"], weight: 2 }, { items: ["y", "x"] }], self), ["x", "y"]);
  // b gets 1/(k+2) + 1/(k+3): below a's 1/(k+1) at k = 0, above it at the default 60.
  const twoArms = [{ items: ["a", "b"] }, { items: ["c", "d", "b"] }];
  assert.deepEqual(fuseRankings(twoArms, self, { k: 0 }), ["a", "c", "b", "d"]);
  assert.deepEqual(fuseRankings(twoArms, self), ["b", "a", "c", "d"]);
  const list = [{ items: ["a", "b", "c"] }];
  assert.deepEqual(fuseRankings(list, self, { limit: 2 }), ["a", "b"]);
  assert.deepEqual(fuseRankings(list, self, { limit: 0 }), ["a", "b", "c"]);
  assert.deepEqual(fuseRankings(list, self, { limit: 0xffff_ffff }), ["a", "b", "c"]);
});

test("fuseRankings counts every occurrence of a repeated id", () => {
  // a: 1/61 + 1/63, b: 1/62.
  assert.deepEqual(fuseRankings([{ items: ["a", "b", "a"] }], self), ["a", "b"]);
});

test("fuseRankings breaks ties on code point order, not localeCompare", () => {
  // localeCompare puts "a" before "Z"; code point order puts "Z" (U+005A) first.
  assert.deepEqual(fuseRankings([{ items: ["a"] }, { items: ["Z"] }], self), ["Z", "a"]);
});

test("fuseRankings rejects a bad k or limit before WASM", () => {
  for (const bad of [-1, 1.5, Number.NaN, 2 ** 32, Number.POSITIVE_INFINITY]) {
    assert.throws(() => fuseRankings([{ items: ["a"] }], self, { k: bad }), (e: unknown) => e instanceof RangeError && /^k /.test(e.message));
    assert.throws(() => fuseRankings([{ items: ["a"] }], self, { limit: bad }), (e: unknown) => e instanceof RangeError && /^limit /.test(e.message));
  }
});

test("fuseRankings rejects a weight that is negative or not finite", () => {
  for (const weight of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => fuseRankings([{ items: ["a"] }, { items: ["b"], weight }], self), /list 1 weight/);
  }
});

test("fuseRankings rejects more than MAX_FUSION_IDS ids in total before identify runs", () => {
  // Each list is under the cap; together they are one over it.
  let calls = 0;
  const half = () => ({ items: new Array<string>(2 ** 19).fill("a") });
  const count = (id: string) => {
    calls += 1;
    return id;
  };
  const over = [half(), { items: ["b"] }, half()];
  assert.throws(() => fuseRankings(over, count), (e: unknown) => e instanceof RangeError && /lists have 1048577 ids in total; MAX_FUSION_IDS is 1048576/.test(e.message));
  assert.equal(calls, 0);
  assert.equal(fuseRankings([half(), half()], self).length, 1);
});

test("fuseRankings raw export rejects more than MAX_FUSION_IDS ids in total", () => {
  const ids = new Array<string>(2 ** 19 + 1).fill("a");
  assert.throws(() => rawFuseRankings([{ ids, weight: 1 }, { ids, weight: 1 }]), /lists have 1048578 ids in total; MAX_FUSION_IDS is 1048576/);
});

test("index.ts does not re-export RankedList", () => {
  // Its generated weight is `number | null`, but Rust rejects null; the wrapper's {items, weight?} is the public shape.
  const src = read(new URL("../src/index.ts", import.meta.url));
  assert.doesNotMatch(src, /export type \{[^}]*RankedList/);
});

test("buildExcerpt highlights each term in a short body", () => {
  assert.deepEqual(buildExcerpt("Graph neural networks", ["GRAPH", "Networks"]), {
    text: "Graph neural networks",
    highlights: [
      { start: 0, end: 5 },
      { start: 13, end: 21 },
    ],
  });
  assert.deepEqual(buildExcerpt("", ["x"]), { text: "", highlights: [] });
});

test("buildExcerpt keeps newlines only with singleLine false", () => {
  const body = "line one\n\nline two";
  assert.equal(buildExcerpt(body, ["two"]).text, "line one line two");
  assert.equal(buildExcerpt(body, ["two"], { singleLine: false }).text, body);
});

test("buildExcerpt keeps a split surrogate half instead of U+FFFD", () => {
  // The 40-unit window cuts through the emoji run, so one edge splits a pair.
  const emoji = "\u{1f600}".repeat(30);
  const { text, highlights } = buildExcerpt(`${emoji}hit${emoji}`, ["hit"], { maxChars: 40 });
  assert.ok(!text.includes("�"));
  // A lone surrogate survives (split emoji at the cut), like the TS original.
  assert.match(text, /\p{Cs}/u);
  assert.equal(highlights.length, 1);
  assert.equal(text.slice(highlights[0]!.start, highlights[0]!.end), "hit");
});

test("buildExcerpt decodes a text longer than one 8192-unit chunk", () => {
  const { text, highlights } = buildExcerpt("word ".repeat(20_000), ["word"], { maxChars: 50_000 });
  assert.ok(text.length > 3 * 8192);
  assert.ok(highlights.length > 1000);
  for (const h of highlights) assert.equal(text.slice(h.start, h.end), "word");
});

test("buildExcerpt rejects a body over MAX_INDEX_TEXT_UTF16 before WASM", () => {
  const huge = "a".repeat(2 ** 24 + 1);
  assert.throws(() => buildExcerpt(huge, ["a"]), (e: unknown) => e instanceof RangeError && /MAX_INDEX_TEXT_UTF16/.test(e.message));
});

test("buildExcerpt rejects terms over MAX_INDEX_TEXT_UTF16 in total before WASM", () => {
  // Each term is under the cap; together they are one over it.
  const half = "a".repeat(2 ** 23);
  const message = /^terms are 16777217 UTF-16 units in total; MAX_INDEX_TEXT_UTF16 is 16777216$/;
  assert.throws(() => buildExcerpt("x", [half, half, "b"]), (e: unknown) => e instanceof RangeError && message.test(e.message));
  assert.equal(buildExcerpt("x", [half, half]).text, "x");
});

test("buildExcerpt raw export rejects terms over MAX_INDEX_TEXT_UTF16 in total", () => {
  const half = "a".repeat(2 ** 23);
  assert.throws(() => rawBuildExcerpt("x", [half, half, "b"]), /terms are 16777217 UTF-16 units in total; MAX_INDEX_TEXT_UTF16 is 16777216/);
  assert.throws(() => rawBuildExcerpt("x", "not an array"));
});

test("buildExcerpt rejects a bad maxChars before WASM", () => {
  for (const bad of [-1, 1.5, Number.NaN, 2 ** 32, Number.POSITIVE_INFINITY]) {
    assert.throws(() => buildExcerpt("x", ["x"], { maxChars: bad }), (e: unknown) => e instanceof RangeError && /^maxChars /.test(e.message));
  }
  assert.equal(buildExcerpt("x", ["x"], { maxChars: 0xffff_ffff }).text, "x");
});
