import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust ranking rules return exactly what the TS original in
// packages/core/src/search/search-tuning.ts returns. One fixed clock on both sides.

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

/** Sorted keys: Rust map order differs from JS insertion order. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortKeys(record[key])]));
  }
  return value;
}

/** JSON round trip drops `undefined` keys, which serde also omits. */
const canon = (value: unknown): unknown =>
  value === undefined ? undefined : sortKeys(JSON.parse(JSON.stringify(value)) as unknown);

type Outcome = { ok: true; value: unknown } | { ok: false };
function run(fn: () => unknown): Outcome {
  try {
    return { ok: true, value: canon(fn()) };
  } catch {
    return { ok: false };
  }
}

/** Both sides must agree on the value, or both must throw. */
function assertParity(label: string, tsFn: () => unknown, rsFn: () => unknown): void {
  assert.deepEqual(run(rsFn), run(tsFn), label);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);

type Doc = Parameters<typeof ts.documentBoost>[0];
type Options = Parameters<typeof ts.documentBoost>[1];

const TERM_CHARS = ["a", "Z", "é", "ß", "ǆ", "Ö", "😀", " ", " ", "﻿", "\n", " "];
const LISTS: string[][] = [[], ["a"], ["Ölçü", "émile"]];
const DEGREES = [0, 1, 2, 5, 60, 65, 1e6, -1, -40, 0.5, 3.7];
const HALF_LIVES = [0.5, 1, 30, 180, 365];
const KIND_FACTORS = [0, 0.25, 1, 2];
const OFFSETS = ["Z", "+05:30", "-07:00", "+00:00"];

const iso = (ms: number): string => new Date(ms).toISOString();

/** Full SearchDoc shape; only `degree` and `updatedAt` reach documentBoost's maths. */
function makeDoc(degree: number, updatedAt: string | undefined, lists: string[] = []): Doc {
  return {
    id: "note:n1", kind: "note", entityId: "n1", title: "Title", aliases: lists,
    headings: lists, tags: lists, path: "", body: "", href: "/n1", degree, updatedAt,
  } as unknown as Doc;
}

/** Dates within roughly three years either side of NOW, always ISO 8601 with Z or an offset. */
function randomUpdatedAt(rand: () => number): string {
  const stamp = iso(Math.round(NOW + (rand() * 4000 - 3000) * DAY_MS));
  return rand() < 0.5 ? stamp : stamp.replace("Z", pick(rand, OFFSETS));
}

/** Always carries `now`: TS and Rust both fall back to the wall clock otherwise. */
function randomOptions(rand: () => number): Options {
  return {
    now: NOW,
    ...(rand() < 0.5 ? { recencyHalfLifeDays: pick(rand, HALF_LIVES) } : {}),
    ...(rand() < 0.5 ? { kindMultiplier: pick(rand, KIND_FACTORS) } : {}),
    ...(rand() < 0.5 ? { recency: rand() < 0.7 } : {}),
  };
}

test("search-tuning constants match TS", () => {
  assert.deepEqual(
    canon({
      boosts: rs.FIELD_BOOSTS,
      fields: rs.SEARCH_FIELDS,
      prefix: rs.MIN_PREFIX_LENGTH,
      body: rs.MAX_INDEXED_BODY_CHARS,
      corpus: rs.LARGE_CORPUS_WARNING,
    }),
    canon({
      boosts: ts.FIELD_BOOSTS,
      fields: ts.SEARCH_FIELDS,
      prefix: ts.MIN_PREFIX_LENGTH,
      body: ts.MAX_INDEXED_BODY_CHARS,
      corpus: ts.LARGE_CORPUS_WARNING,
    }),
  );
});

test("fuzzinessForTerm matches TS on seeded terms", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    const length = Math.floor(rand() * 9);
    const term = Array.from({ length }, () => pick(rand, TERM_CHARS)).join("");
    assertParity(
      `seed ${seed}`,
      () => ts.fuzzinessForTerm(term),
      () => rs.fuzzinessForTerm(term),
    );
  }
});

test("fuzzinessForTerm matches TS at length boundaries and astral text", () => {
  // Length is UTF-16 units in TS; a Rust char count would disagree on the emoji rows.
  const terms = ["", "a", "ab", "abc", "abcd", "abcde", "abcdef", "😀😀", "😀a", "😀😀😀", "ßßßß", "éééé", "áb", "    "];
  terms.forEach((term) =>
    assertParity(
      `term ${JSON.stringify(term)}`,
      () => ts.fuzzinessForTerm(term),
      () => rs.fuzzinessForTerm(term),
    ),
  );
});

test("documentBoost matches TS on seeded docs and options", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    const doc = makeDoc(pick(rand, DEGREES), randomUpdatedAt(rand), pick(rand, LISTS));
    const options = randomOptions(rand);
    assertParity(
      `seed ${seed}`,
      () => ts.documentBoost(doc, options),
      () => rs.documentBoost(doc, options),
    );
  }
});

test("documentBoost matches TS on missing fields and boundary dates", () => {
  const cases: Array<[Doc, Options]> = [
    [makeDoc(0, iso(NOW)), { now: NOW }],
    [makeDoc(3, undefined), { now: NOW }],
    [makeDoc(3, undefined), { now: NOW, recency: false }],
    [makeDoc(-40, iso(NOW)), { now: NOW }],
    [makeDoc(5, iso(NOW + 10 * DAY_MS)), { now: NOW }],
    [makeDoc(5, iso(NOW)), { now: NOW, recencyHalfLifeDays: 1 }],
    [makeDoc(5, iso(NOW - 1000 * DAY_MS)), { now: NOW, kindMultiplier: 0 }],
    [makeDoc(1e6, iso(NOW - 3 * DAY_MS)), { now: NOW, recency: false, kindMultiplier: 0.25 }],
    [makeDoc(2, "2026-11-05T12:00:00.123Z"), { now: NOW }],
    [makeDoc(2, "2026-11-05T12:00:00.123-07:00"), { now: NOW }],
    [makeDoc(2, "1969-07-20T20:17:00Z"), { now: NOW }],
    [makeDoc(0.5, "2026-11-05T12:00:00+05:30", ["x"]), { now: NOW, kindMultiplier: 2 }],
  ];
  cases.forEach(([doc, options], i) =>
    assertParity(
      `case ${i}`,
      () => ts.documentBoost(doc, options),
      () => rs.documentBoost(doc, options),
    ),
  );
});
