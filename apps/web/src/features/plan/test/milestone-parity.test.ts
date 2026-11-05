// Proves the Rust milestone rules match packages/core/src/features/plan/domain/milestone.ts
// (isIsoDay, validateDependencies, validateCompute, createMilestone): same result, same first error,
// and no id or clock call when validation throws.

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

const maybeOf = <T>(rand: () => number, items: readonly T[]): T | undefined =>
  rand() < 0.5 ? pick(rand, items) : undefined;

const list = <T>(rand: () => number, make: (rand: () => number) => T): T[] =>
  Array.from({ length: Math.floor(rand() * 4) }, () => make(rand));

/** JSON round trip: TS leaves `undefined` keys that serde omits; both mean "absent". */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

type Input = Parameters<typeof ts.createMilestone>[0];
type Deps = Parameters<typeof ts.createMilestone>[1];
type Dep = NonNullable<Input["dependencies"]>[number];
type Need = NonNullable<Input["compute"]>[number];
type Calls = { clock: number; ids: number };
type Run =
  | { ok: true; value: unknown; calls: Calls }
  | { ok: false; message: string; calls: Calls };
type Outcome = { ok: true } | { ok: false; message: string };

/** Runs one create and records the outcome plus how often the clock and id generator ran. */
function build(make: (input: Input, deps: Deps) => unknown, input: Input): Run {
  const calls: Calls = { clock: 0, ids: 0 };
  const deps: Deps = {
    clock: { nowIso: () => ((calls.clock += 1), "2026-11-05T00:00:00.000Z") },
    ids: { newId: () => ((calls.ids += 1), "m-fixed") },
  };
  try {
    return { ok: true as const, value: make(input, deps), calls };
  } catch (error) {
    return { ok: false as const, message: (error as Error).message, calls };
  }
}

/** Runs a validator that returns nothing; a throw becomes `{ ok: false, message }`. */
function check(fn: () => void): Outcome {
  try {
    fn();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

// JS-only whitespace ( ,  , 　, ﻿) must be trimmed the same way on both sides.
const TITLES = ["", " ", " ", "﻿", " ", "﻿ ", "  Draft ch.2 ", "　Ölçü ", "ǆ title", "ß", "😀 plan", "​zero-width"];
const WORDS = ["", "Intro", "émile", "line\nbreak", "<b>x</b>"];
// Odd and empty dates: leap years, bad months, trailing newline, Arabic digits, non-dates.
const DATES = ["", "2026-02-28", "2024-02-29", "2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-1-01", "20260101", "2026-01-01\n", " 2026-01-01", "0000-02-29", "1900-02-29", "2000-02-29", "9999-12-31", "abcd-ef-gh", "٢٠٢٦-01-01", "x"];
const REF_IDS = ["", " ", " ", "m1", "e 2", "﻿"];
const LABELS = ["", " ", " ", "Dataset access", "﻿Supervisor", "﻿"];
const RESOURCES = ["A100", "", " ", " ", "storage", " CPU", "﻿"];
// Zero, negative, fractional and large values; Infinity and NaN are left out (JSON turns them into null).
const COUNTS = [0, -1, 1.5, 4, 1e308];
const HOURS = [0, -0.5, 200, 1e308];

function genDep(rand: () => number): Dep {
  return { kind: pick(rand, ts.DEPENDENCY_KINDS), refId: maybeOf(rand, REF_IDS), label: maybeOf(rand, LABELS) };
}

function genNeed(rand: () => number): Need {
  return {
    resource: pick(rand, RESOURCES),
    count: maybeOf(rand, COUNTS),
    hours: maybeOf(rand, HOURS),
    notes: maybeOf(rand, WORDS),
  };
}

function genInput(rand: () => number): Input {
  return {
    title: pick(rand, TITLES),
    description: maybeOf(rand, WORDS),
    status: maybeOf(rand, ts.MILESTONE_STATUSES),
    targetDate: maybeOf(rand, DATES),
    dependencies: rand() < 0.5 ? list(rand, genDep) : undefined,
    compute: rand() < 0.5 ? list(rand, genNeed) : undefined,
  };
}

test("isIsoDay matches TS on odd and seeded date strings", () => {
  for (const value of DATES) {
    assert.equal(rs.isIsoDay(value), ts.isIsoDay(value), JSON.stringify(value));
  }
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    const pad = (n: number, width: number) => String(n).padStart(width, "0");
    const value = `${pad(Math.floor(rand() * 10000), 4)}-${pad(Math.floor(rand() * 14), 2)}-${pad(Math.floor(rand() * 33), 2)}`;
    assert.equal(rs.isIsoDay(value), ts.isIsoDay(value), `seed ${seed} ${value}`);
  }
});

test("validateDependencies and validateCompute match TS on seeded lists", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    const deps = list(rand, genDep);
    const needs = list(rand, genNeed);
    assert.deepEqual(
      plain(check(() => rs.validateDependencies(deps))),
      plain(check(() => ts.validateDependencies(deps))),
      `deps seed ${seed}`,
    );
    assert.deepEqual(
      plain(check(() => rs.validateCompute(needs))),
      plain(check(() => ts.validateCompute(needs))),
      `compute seed ${seed}`,
    );
  }
});

test("createMilestone matches TS on seeded inputs", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const input = genInput(random(seed));
    assert.deepEqual(plain(build(rs.createMilestone, input)), plain(build(ts.createMilestone, input)), `seed ${seed}`);
  }
});

test("blank title throws on both sides before id or clock run", () => {
  for (const title of TITLES.filter((t) => t.trim() === "")) {
    const input: Input = { title };
    const label = JSON.stringify(title);
    const tsRun = build(ts.createMilestone, input);
    const rsRun = build(rs.createMilestone, input);
    assert.equal(tsRun.ok, false, `TS accepted blank title ${label}`);
    assert.equal(rsRun.ok, false, `Rust accepted blank title ${label}`);
    assert.deepEqual(plain(rsRun), plain(tsRun), label);
    assert.deepEqual(tsRun.calls, { clock: 0, ids: 0 }, `TS called deps for ${label}`);
    assert.deepEqual(rsRun.calls, { clock: 0, ids: 0 }, `Rust called deps for ${label}`);
  }
});

test("bad target date throws on both sides, title checked first", () => {
  const bad: Input = { title: "  ", targetDate: "2026-02-31" };
  assert.deepEqual(plain(build(rs.createMilestone, bad)), plain(build(ts.createMilestone, bad)));
  for (const targetDate of ["2026-02-29", "2026-1-01", "2026-01-01\n", "x"]) {
    const input: Input = { title: "t", targetDate };
    assert.equal(build(ts.createMilestone, input).ok, false, JSON.stringify(targetDate));
    assert.deepEqual(plain(build(rs.createMilestone, input)), plain(build(ts.createMilestone, input)), JSON.stringify(targetDate));
  }
});

test("empty target date is treated as absent on both sides", () => {
  const input: Input = { title: "t", targetDate: "" };
  assert.deepEqual(plain(build(rs.createMilestone, input)), plain(build(ts.createMilestone, input)));
});

test("status is kept and defaults to planned on both sides", () => {
  for (const status of ts.MILESTONE_STATUSES) {
    const input: Input = { title: "t", status };
    assert.deepEqual(plain(build(rs.createMilestone, input)), plain(build(ts.createMilestone, input)), status);
  }
  const bare: Input = { title: "t" };
  assert.deepEqual(plain(build(rs.createMilestone, bare)), plain(build(ts.createMilestone, bare)));
});

test("title trimming with Unicode spaces matches TS", () => {
  for (const title of [" Draft ", "　Ölçü ", "﻿Draft﻿", "​Draft"]) {
    const input: Input = { title };
    assert.deepEqual(plain(build(rs.createMilestone, input)), plain(build(ts.createMilestone, input)), JSON.stringify(title));
  }
});
