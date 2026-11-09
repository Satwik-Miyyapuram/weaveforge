import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust related-arm helpers return exactly what the TS originals in
// packages/core/src/search/related.ts return: explainArm and MIN_SEED_DEGREE_FOR_PPR.
// findRelated has no TS original any more: it is Rust only (wf-core search::related),
// tested by its literal Rust tests, and called through readyCore().findRelated.

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

type Arm = Parameters<typeof ts.explainArm>[0];
const ARMS: readonly Arm[] = ["graph", "lexical", "semantic", "tags", "none"];

test("MIN_SEED_DEGREE_FOR_PPR matches TS", () => {
  assert.equal(rs.MIN_SEED_DEGREE_FOR_PPR, ts.MIN_SEED_DEGREE_FOR_PPR);
});

test("explainArm matches TS for every arm", () => {
  for (const arm of ARMS) {
    assert.deepEqual(plain(rs.explainArm(arm)), plain(ts.explainArm(arm)), arm);
  }
});

test("explainArm matches TS across seeds", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const arm = pick(random(seed), ARMS);
    assert.deepEqual(plain(rs.explainArm(arm)), plain(ts.explainArm(arm)), `seed ${seed}: ${arm}`);
  }
});
