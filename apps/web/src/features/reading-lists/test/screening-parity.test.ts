import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust screening rules return exactly what the TS original in
// packages/core/src/features/reading-lists/domain/screening.ts returns. Inputs are seeded,
// so a failure reproduces from the seed.

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

/** Drops `undefined`, as the Rust side never sends it. */
function plain<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);
const ITEMS = ["i1", "i2", "i3", "i4", "i5"];
const REVIEWERS = ["ann", "bob", "cy"];
// ASCII only: the Rust localeCompare is exact for ASCII, approximate past it.
const REASONS = ["wrong population", "Wrong population", "  no full text ", "", "   ", "design", "Design", "a-b", "a_b"];
const TIMES = ["2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z"];

function decisions(rand: () => number): ts.ScreeningDecision[] {
  return Array.from({ length: Math.floor(rand() * 25) }, (_, i) => {
    const decision: ts.ScreeningDecision = {
      id: `d${i}`,
      itemId: pick(rand, ITEMS),
      reviewerId: pick(rand, REVIEWERS),
      stage: pick(rand, ts.SCREENING_STAGES),
      state: pick(rand, ts.SCREENING_STATES),
      decidedAt: pick(rand, TIMES),
    };
    if (rand() < 0.6) decision.reason = pick(rand, REASONS);
    return decision;
  });
}

function run(call: () => unknown): unknown {
  try {
    call();
    return { ok: true };
  } catch (error) {
    const e = error as Error;
    return { error: e.message, name: e.name };
  }
}

test("checkDecision matches TS, including errors", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const existing = decisions(rand);
    const next = {
      itemId: pick(rand, ITEMS),
      reviewerId: pick(rand, REVIEWERS),
      stage: pick(rand, [...ts.SCREENING_STAGES, "other"]) as ts.ScreeningStage,
      state: pick(rand, [...ts.SCREENING_STATES, "maybe", ""]) as ts.ScreeningState,
    };
    assert.deepEqual(run(() => rs.checkDecision(next, existing)), run(() => ts.checkDecision(next, existing)), `seed ${seed}`);
  }
});

test("latestByReviewer and verdictFor match TS", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const ds = decisions(rand);
    for (const itemId of ITEMS) {
      for (const stage of ts.SCREENING_STAGES) {
        assert.deepEqual(
          plain([...rs.latestByReviewer(ds, itemId, stage)]),
          plain([...ts.latestByReviewer(ds, itemId, stage)]),
          `seed ${seed} ${itemId} ${stage}`,
        );
        assert.deepEqual(rs.verdictFor(ds, itemId, stage), ts.verdictFor(ds, itemId, stage), `seed ${seed}`);
      }
    }
  }
});

test("agreementBetween matches TS", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const ds = decisions(rand);
    const reviewers: [string, string] = [pick(rand, REVIEWERS), pick(rand, [...REVIEWERS, "nobody"])];
    for (const stage of ts.SCREENING_STAGES) {
      assert.deepEqual(rs.agreementBetween(ds, reviewers, stage), ts.agreementBetween(ds, reviewers, stage), `seed ${seed}`);
    }
  }
});

test("prismaCounts and exclusionReasons match TS", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const ds = decisions(rand);
    const items: ts.ScreeningItem[] = ITEMS.slice(0, Math.floor(rand() * 6)).map((id) => {
      const item: ts.ScreeningItem = { id };
      if (rand() < 0.25) item.duplicateOfItemId = pick(rand, ["i1", ""]);
      return item;
    });
    assert.deepEqual(rs.prismaCounts(items, ds), ts.prismaCounts(items, ds), `seed ${seed}`);
    assert.deepEqual(rs.exclusionReasons(ds), ts.exclusionReasons(ds), `seed ${seed}`);
    assert.deepEqual(rs.exclusionReasons(ds, "title_abstract"), ts.exclusionReasons(ds, "title_abstract"), `seed ${seed}`);
  }
});
