import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust lab snapshot builder freezes exactly the fields the TS original
// in packages/core/src/features/org/domain/lab-snapshot.ts keeps.

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

/** JSON round trip: TS leaves `undefined` keys that serde omits; both mean "absent". */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

const WORDS = ["", "Intro", "Ölçü run", "  spaced  ", "line\nbreak", "<b>x</b>", "émile"];
const maybe = (rand: () => number): string | undefined => (rand() < 0.5 ? pick(rand, WORDS) : undefined);
const list = <T>(rand: () => number, make: (i: number) => T): T[] =>
  Array.from({ length: Math.floor(rand() * 5) }, (_, i) => make(i));

type Input = Parameters<typeof ts.buildLabSnapshotContent>[0];

test("buildLabSnapshotContent matches TS on seeded live records", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    // Extra fields stand in for the rest of each live record; both sides must drop them.
    const input = {
      milestones: list(rand, (i) => ({
        id: `m${i}`, title: pick(rand, WORDS), description: maybe(rand), targetDate: maybe(rand),
        status: pick(rand, ["planned", "in_progress", "done", "blocked"] as const), projectId: "p", createdAt: "x",
      })),
      logs: list(rand, (i) => ({
        id: `l${i}`, entryDate: "2026-11-05", kind: pick(rand, ["daily", "weekly"] as const),
        body: pick(rand, WORDS), projectId: "p",
      })),
      experiments: list(rand, (i) => ({
        id: `e${i}`, name: pick(rand, WORDS), resultNote: maybe(rand), config: { a: 1 }, metrics: {}, artifacts: [],
        status: pick(rand, ["planned", "running", "done", "failed", "abandoned"] as const), createdAt: "x",
      })),
      report: list(rand, (i) => ({
        id: `r${i}`, title: pick(rand, WORDS), status: pick(rand, ts.REPORT_STATUSES),
        wordCount: Math.floor(rand() * 5000), body: "text",
      })),
      ...(rand() < 0.5 ? { aiAssisted: Math.floor(rand() * 20) } : {}),
    } as unknown as Input;
    assert.deepEqual(
      plain(rs.buildLabSnapshotContent(input)),
      plain(ts.buildLabSnapshotContent(input)),
      `seed ${seed}`,
    );
  }
});
