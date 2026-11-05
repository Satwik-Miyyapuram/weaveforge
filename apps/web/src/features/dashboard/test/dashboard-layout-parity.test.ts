import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust dashboard layout check returns exactly what the TS original in
// packages/core/src/features/dashboard/domain/parse-dashboard-layout.ts returns.

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

// No NaN/Infinity (the bridge reads them as null, TS keeps them as numbers) and no -0.
const JUNK: unknown[] = [null, undefined, "x", "", true, 3, [], {}];
const TYPES = [...ts.DASHBOARD_CARD_TYPES, "nope", "Top-Tags", ""];
const NUMS: unknown[] = [0, 1, 2.5, -3, 12, "1", null, undefined];

function card(rand: () => number): unknown {
  if (rand() < 0.1) return pick(rand, JUNK);
  const o: Record<string, unknown> = {
    id: rand() < 0.9 ? `c${Math.floor(rand() * 9)}` : pick(rand, JUNK),
    type: rand() < 0.85 ? pick(rand, TYPES) : pick(rand, JUNK),
  };
  for (const k of ["x", "y", "w", "h"]) {
    const v = rand() < 0.9 ? Math.floor(rand() * 12) : pick(rand, NUMS);
    if (v !== undefined) o[k] = v;
  }
  if (rand() < 0.3) o.config = { n: Math.floor(rand() * 5), tag: "x" };
  if (rand() < 0.1) o.minW = 2;
  return o;
}

function list(rand: () => number): unknown {
  if (rand() < 0.1) return pick(rand, JUNK);
  return Array.from({ length: Math.floor(rand() * 6) }, () => card(rand));
}

test("parseDashboardLayout matches TS", () => {
  for (const raw of JUNK) assert.deepEqual(rs.parseDashboardLayout(raw), ts.parseDashboardLayout(raw));
  for (let seed = 1; seed <= 500; seed++) {
    const rand = random(seed);
    const raw: Record<string, unknown> = {};
    if (rand() < 0.95) raw.lg = list(rand);
    if (rand() < 0.95) raw.sm = list(rand);
    if (rand() < 0.2) raw.extra = "kept out";
    assert.deepEqual(rs.parseDashboardLayout(raw), ts.parseDashboardLayout(raw), `seed ${seed}`);
  }
});
