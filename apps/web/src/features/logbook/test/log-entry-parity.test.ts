// Proves the Rust log entry builder matches packages/core/src/features/logbook/domain/log-entry.ts
// (createLogEntry, LOG_KINDS): same entry on success, same throw on a blank body, and no clock or id call on throw.

import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

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

type Input = Parameters<typeof ts.createLogEntry>[0];
type Deps = Parameters<typeof ts.createLogEntry>[1];
type Make = (input: Input, deps: Deps) => unknown;
type Calls = { clock: number; ids: number };
type Run =
  | { ok: true; value: unknown; calls: Calls }
  | { ok: false; message: string; calls: Calls };

/** Runs one build and records the outcome plus how often the clock and id generator ran. */
function build(make: Make, input: Input, now: string): Run {
  const calls: Calls = { clock: 0, ids: 0 };
  const deps: Deps = {
    clock: {
      nowIso: () => {
        calls.clock += 1;
        return now;
      },
    },
    ids: {
      newId: () => {
        calls.ids += 1;
        return "id-fixed";
      },
    },
  };
  try {
    return { ok: true as const, value: make(input, deps), calls };
  } catch (error) {
    return { ok: false as const, message: (error as Error).message, calls };
  }
}

// Includes JS-only whitespace (NBSP, BOM, em space, line separator, ideographic space).
const BLANKS = ["", " ", "\t\n\r", " ", "﻿", " ", "\u2028", "　", "  ﻿  "];
const BODIES = ["x", "  hi  ", "émile", "ǆ", "ß", "😀 emoji", "line\nbreak", " spaced ", "​zero-width"];
const DATES = ["2026-11-05", "", "x", "2024-02-29"];
const NOWS = ["2024-03-15T10:20:30.000Z", "x", "", "2026-11-05T00:00:00Z"];

function genInput(rand: () => number): Input {
  const body = rand() < 0.25 ? pick(rand, BLANKS) : pick(rand, BODIES);
  return {
    body,
    ...(rand() < 0.5 ? { entryDate: pick(rand, DATES) } : {}),
    ...(rand() < 0.5 ? { kind: pick(rand, ts.LOG_KINDS) } : {}),
    ...(rand() < 0.5
      ? { links: Array.from({ length: Math.floor(rand() * 3) }, (_, i) => ({ type: "paper", id: `p${i}` })) }
      : {}),
  };
}

test("LOG_KINDS equals TS", () => {
  assert.deepEqual(plain(rs.LOG_KINDS), plain(ts.LOG_KINDS));
});

test("createLogEntry matches TS on seeded inputs", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    const input = genInput(rand);
    const now = pick(rand, NOWS);
    assert.deepEqual(
      plain(build(rs.createLogEntry, input, now)),
      plain(build(ts.createLogEntry, input, now)),
      `seed ${seed}`,
    );
  }
});

test("blank body after trimming throws on both sides before clock or ids run", () => {
  for (const body of BLANKS) {
    const input: Input = { body };
    const tsRun = build(ts.createLogEntry, input, NOWS[0]!);
    const rsRun = build(rs.createLogEntry, input, NOWS[0]!);
    const label = JSON.stringify(body);
    assert.equal(tsRun.ok, false, `TS accepted blank ${label}`);
    assert.equal(rsRun.ok, false, `Rust accepted blank ${label}`);
    assert.deepEqual(plain(rsRun), plain(tsRun), label);
    assert.deepEqual(tsRun.calls, { clock: 0, ids: 0 }, `TS called deps for ${label}`);
    assert.deepEqual(rsRun.calls, { clock: 0, ids: 0 }, `Rust called deps for ${label}`);
  }
});

test("missing body reads as blank on both sides", () => {
  const input = {} as Input;
  const tsRun = build(ts.createLogEntry, input, NOWS[0]!);
  const rsRun = build(rs.createLogEntry, input, NOWS[0]!);
  assert.equal(tsRun.ok, false);
  assert.deepEqual(plain(rsRun), plain(tsRun));
  assert.deepEqual(rsRun.calls, { clock: 0, ids: 0 });
});

test("zero-width space is not whitespace: body kept on both sides", () => {
  const input: Input = { body: "​" };
  const tsRun = build(ts.createLogEntry, input, NOWS[0]!);
  assert.deepEqual(plain(build(rs.createLogEntry, input, NOWS[0]!)), plain(tsRun));
  assert.equal(tsRun.ok, true);
});

test("Unicode-space body is trimmed to the same text on both sides", () => {
  const input: Input = { body: "﻿  spaced  　" };
  const tsRun = build(ts.createLogEntry, input, NOWS[0]!);
  assert.deepEqual(plain(build(rs.createLogEntry, input, NOWS[0]!)), plain(tsRun));
  assert.equal(tsRun.ok && (tsRun.value as { body: string }).body, "spaced");
});

test("missing optional fields take defaults from now on both sides", () => {
  const input: Input = { body: "  x  " };
  const tsRun = build(ts.createLogEntry, input, NOWS[0]!);
  assert.deepEqual(plain(build(rs.createLogEntry, input, NOWS[0]!)), plain(tsRun));
  assert.deepEqual(tsRun.ok && plain(tsRun.value), {
    id: "id-fixed",
    entryDate: "2024-03-15",
    kind: "daily",
    body: "x",
    links: [],
    createdAt: NOWS[0],
  });
});

test("successful build calls clock and ids exactly once on both sides", () => {
  const input: Input = { body: "ok" };
  assert.deepEqual(build(ts.createLogEntry, input, NOWS[0]!).calls, { clock: 1, ids: 1 });
  assert.deepEqual(build(rs.createLogEntry, input, NOWS[0]!).calls, { clock: 1, ids: 1 });
});
