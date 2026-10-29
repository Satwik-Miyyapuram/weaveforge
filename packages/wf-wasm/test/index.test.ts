import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  coreInfo,
  indexTerms,
  initSync,
  maxIndexTextUtf16,
  tokenize,
  type TokenizerOptions,
} from "../src/index.js";

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
    assert.match(src, new RegExp(`^export function ${name}\\(`, "m"), `no typed wrapper for ${name}`);
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
