import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust paper record rules return exactly what the TS originals in
// packages/core/src/features/papers/domain/{paper,paper-field,annotation-quotation-type}.ts
// return. Inputs are seeded, so a failure reproduces from the seed.

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

/** Mulberry32, so a failure reproduces from the seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

function join(rand: () => number, parts: readonly string[], max: number): string {
  const count = Math.floor(rand() * max);
  return Array.from({ length: count }, () => pick(rand, parts)).join("");
}

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);

const DOI_PARTS = [
  "10.1000/XYZ",
  "https://doi.org/",
  "http://dx.doi.org/",
  "HTTPS://DOI.ORG/",
  "https://dx.doi.org/",
  "doi.org/",
  " ",
  "\t",
  " ",
  "ABC",
  "İ",
  "ß",
  "/",
  "Σ",
];

test("normalizeDoi matches TS", () => {
  const fixed = [undefined, "", " ", " ", "https://doi.org/10.1/A", "  http://dx.doi.org/10.1/B  "];
  for (const doi of fixed) assert.equal(rs.normalizeDoi(doi), ts.normalizeDoi(doi), String(doi));
  for (const seed of SEEDS) {
    const doi = join(random(seed), DOI_PARTS, 6);
    assert.equal(rs.normalizeDoi(doi), ts.normalizeDoi(doi), `seed ${seed}: ${JSON.stringify(doi)}`);
  }
});

const TAG_PARTS = ["#", "##", " ", "　", "ML", "ml", "Ünï", "İ", "x", "-", "_", "\n", "🎉"];

test("normalizeTags matches TS", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const tags = Array.from({ length: Math.floor(rand() * 8) }, () => join(rand, TAG_PARTS, 5));
    assert.deepEqual(rs.normalizeTags(tags), ts.normalizeTags(tags), `seed ${seed}`);
  }
});

const TEXT_PARTS = [
  "#tag",
  "#Tag",
  "##double",
  "#über",
  "#漢字",
  "#a_b-c",
  "#123",
  "#",
  " ",
  "word",
  "x#inner",
  "🎉",
  "#🎉",
  "#𝒳",
  "\n",
  "#İstanbul",
  "é",
  "#é",
];

test("extractHashtagRefs and extractHashtags match TS, with UTF-16 offsets", () => {
  assert.deepEqual(rs.extractHashtagRefs(undefined), ts.extractHashtagRefs(undefined));
  assert.deepEqual(rs.extractHashtags(""), ts.extractHashtags(""));
  for (const seed of SEEDS) {
    const text = join(random(seed), TEXT_PARTS, 12);
    assert.deepEqual(
      JSON.parse(JSON.stringify(rs.extractHashtagRefs(text))),
      JSON.parse(JSON.stringify(ts.extractHashtagRefs(text))),
      `seed ${seed}: ${JSON.stringify(text)}`,
    );
    assert.deepEqual(rs.extractHashtags(text), ts.extractHashtags(text), `seed ${seed}`);
  }
});

test("isEmptyPaperSummary matches TS", () => {
  const cases = [null, undefined, "", " ", " \n", "No summary yet.", "  No summary yet.  ", "no summary yet.", "A summary."];
  for (const summary of cases) {
    assert.equal(rs.isEmptyPaperSummary(summary), ts.isEmptyPaperSummary(summary), JSON.stringify(summary));
  }
});

test("isPaperFieldKind and isQuotationType match TS", () => {
  const values = [
    ...ts.PAPER_FIELD_KINDS,
    ...ts.QUOTATION_TYPES,
    "",
    "Text",
    "multi-select",
    "rollup ",
    "Direct",
    "quote",
    "__proto__",
  ];
  for (const value of values) {
    assert.equal(rs.isPaperFieldKind(value), ts.isPaperFieldKind(value), value);
    assert.equal(rs.isQuotationType(value), ts.isQuotationType(value), value);
  }
});

const AGGS = ["count", "values", "sum", "avg"] as const;
const OPTION_PARTS = ["rel:", "agg:", "src:", "f1", "f2", "count", "sum", "avg", "values", "COUNT", "", ":", " "];

test("encodeRollupOptions and parseRollupOptions match TS", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const config: ts.PaperFieldRollupConfig = {
      relationFieldId: join(rand, ["f", "1", ":", " ", "é"], 4),
      agg: pick(rand, AGGS),
      ...(rand() < 0.5 ? { sourceFieldId: join(rand, ["s", "2", ""], 3) } : {}),
    };
    assert.deepEqual(rs.encodeRollupOptions(config), ts.encodeRollupOptions(config), `seed ${seed}`);
    const options = Array.from({ length: Math.floor(rand() * 6) }, () => join(rand, OPTION_PARTS, 3));
    assert.deepEqual(
      JSON.parse(JSON.stringify(rs.parseRollupOptions(options))),
      JSON.parse(JSON.stringify(ts.parseRollupOptions(options))),
      `seed ${seed}: ${JSON.stringify(options)}`,
    );
    const roundTrip = ts.encodeRollupOptions(config);
    assert.deepEqual(
      JSON.parse(JSON.stringify(rs.parseRollupOptions(roundTrip))),
      JSON.parse(JSON.stringify(ts.parseRollupOptions(roundTrip))),
      `seed ${seed} round trip`,
    );
  }
});
