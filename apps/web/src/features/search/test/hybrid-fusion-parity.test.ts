import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust hybrid fusion helpers match packages/core/src/search/hybrid-fusion.ts
// (stopword stripping, term counts, keyword coverage and vector floor gating).

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

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

/** Whitespace that JS `\s` and Rust `char::is_whitespace` disagree on, plus plain separators. */
const SEPARATORS = [" ", "  ", "\t", "\n", " ", " ", "﻿", "\u0085", " "];
const QUERY_WORDS = [
  "the", "THE", "of", "networks", "a", "kind:note", "-exclude", '"the', 'net"', '"a b"',
  "how", "do", "ǆ", "ß", "émile", "", "only", "ok",
];
const TERMS = ["a", "", "a", "ǆ", "ß", "émile", "é", "é", "net"];
const IDS = ["d1", "d2", "d1", "d3"];
const SCORES = [0.9, 0.6, 0.5, 0.1, 0, -1, 1.5, 0.6];
const TERM_COUNTS = [-1, 0, 0.5, 1, 1.5, 2, 3, 4];
const MIN_COVERAGES = [0, 0.25, 0.5, 1];
const FLOORS = [0.6, 0.5, 0, 1.5, -1];
const KEEP_TOPS = [0, 1, 2, 5, 1.5, -1];

type Hit = { id: string; score: number; queryTerms?: string[] };

function randomQuery(rand: () => number): string {
  let query = rand() < 0.3 ? pick(rand, SEPARATORS) : "";
  const count = Math.floor(rand() * 7);
  for (let i = 0; i < count; i += 1) {
    query += (i > 0 ? pick(rand, SEPARATORS) : "") + pick(rand, QUERY_WORDS);
  }
  return query;
}

function randomTerms(rand: () => number): string[] {
  return Array.from({ length: Math.floor(rand() * 8) }, () => pick(rand, TERMS));
}

function randomHit(rand: () => number): Hit {
  const hit: Hit = { id: pick(rand, IDS), score: pick(rand, SCORES) };
  if (rand() < 0.7) hit.queryTerms = randomTerms(rand);
  return hit;
}

const randomHits = (rand: () => number): Hit[] =>
  Array.from({ length: Math.floor(rand() * 6) }, () => randomHit(rand));

test("stripStopwords matches TS on seeded queries", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const query = randomQuery(random(seed));
    assert.equal(rs.stripStopwords(query), ts.stripStopwords(query), `seed ${seed}`);
  }
});

test("stripStopwords matches TS on BOM, NBSP, NEL, quotes and all-stopword edge cases", () => {
  const queries = [
    "﻿the networks", "the\u0085networks", "the networks", " of networks",
    "", "   ", "\u0085", "﻿", "the\u0085", "\"the net\" of", "kind:note the",
    "the  of", "\"", "the \" of", " the ", "THE﻿OF",
  ];
  for (const query of queries) {
    assert.equal(rs.stripStopwords(query), ts.stripStopwords(query), JSON.stringify(query));
  }
});

test("queryTermCount matches TS on seeded term lists", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const terms = randomTerms(random(seed));
    assert.deepEqual(plain(rs.queryTermCount(terms)), plain(ts.queryTermCount(terms)), `seed ${seed}`);
  }
  assert.equal(rs.queryTermCount([]), ts.queryTermCount([]));
});

test("coveredHits matches TS on seeded hits and term counts", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    const hits = randomHits(rand);
    const termCount = pick(rand, TERM_COUNTS);
    const minCoverage = pick(rand, MIN_COVERAGES);
    assert.deepEqual(
      plain(rs.coveredHits(hits, termCount, minCoverage)),
      plain(ts.coveredHits(hits, termCount, minCoverage)),
      `seed ${seed}`,
    );
    assert.deepEqual(plain(rs.coveredHits(hits, termCount)), plain(ts.coveredHits(hits, termCount)), `default seed ${seed}`);
  }
});

test("gateVectorHits matches TS on seeded hits, floors and keepTop", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    const hits = randomHits(rand);
    const floor = pick(rand, FLOORS);
    const keepTop = pick(rand, KEEP_TOPS);
    assert.deepEqual(
      plain(rs.gateVectorHits(hits, floor, keepTop)),
      plain(ts.gateVectorHits(hits, floor, keepTop)),
      `seed ${seed}`,
    );
    assert.deepEqual(plain(rs.gateVectorHits(hits, floor)), plain(ts.gateVectorHits(hits, floor)), `default seed ${seed}`);
  }
});

test("coverage and gating masks match TS on empty hit lists", () => {
  assert.deepEqual(plain(rs.coveredHits([], 3)), plain(ts.coveredHits([], 3)));
  assert.deepEqual(plain(rs.coveredHits([], 1)), plain(ts.coveredHits([], 1)));
  assert.deepEqual(plain(rs.gateVectorHits([], 0.5)), plain(ts.gateVectorHits([], 0.5)));
});

test("masks match TS on duplicate ids, exact coverage, exact floor ties and keepTop 0", () => {
  const dup: Hit[] = [
    { id: "d1", score: 0.9, queryTerms: ["a"] },
    { id: "d1", score: 0.9, queryTerms: ["a"] },
    { id: "d2", score: 0.2 },
  ];
  assert.deepEqual(plain(rs.coveredHits(dup, 4)), plain(ts.coveredHits(dup, 4)));
  // 2 of 4 terms is exactly the 0.5 coverage floor: kept on both sides.
  const half: Hit[] = [{ id: "x", score: 0, queryTerms: ["a", "b"] }];
  assert.deepEqual(plain(rs.coveredHits(half, 4)), plain(ts.coveredHits(half, 4)));
  assert.equal(rs.coveredHits(half, 4).length, 1);

  const ties: Hit[] = [
    { id: "a", score: 0.6 },
    { id: "b", score: 0.9 },
    { id: "c", score: 0.7 },
    { id: "d", score: 0.2 },
  ];
  assert.deepEqual(plain(rs.gateVectorHits(ties, 0.6)), plain(ts.gateVectorHits(ties, 0.6)));
  assert.deepEqual(plain(rs.gateVectorHits(ties, 0.6, 0)), plain(ts.gateVectorHits(ties, 0.6, 0)));
  assert.deepEqual(plain(rs.gateVectorHits(ties, 0.6, 1.5)), plain(ts.gateVectorHits(ties, 0.6, 1.5)));

  const underFloor: Hit[] = [{ id: "a", score: 0.59 }, { id: "b", score: 0.9 }];
  assert.deepEqual(plain(rs.gateVectorHits(underFloor, 0.6)), plain(ts.gateVectorHits(underFloor, 0.6)));
  assert.deepEqual(plain(rs.gateVectorHits(underFloor, 0.6)), []);
});
