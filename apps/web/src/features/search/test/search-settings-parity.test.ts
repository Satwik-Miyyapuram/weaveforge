import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust search settings helpers return exactly what the TS original in
// packages/core/src/search/search-settings.ts returns, on seeded and hostile input.

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

type Settings = Parameters<typeof ts.kindMultiplier>[1];
type Weights = NonNullable<NonNullable<Settings>["weights"]>;

const NUMBERS: unknown[] = [0, -0, -1, 0.5, 1.5, 7, 19.999, 20, 20.5, 21, 1e9, -1e9, NaN, Infinity, -Infinity];
const JUNK: unknown[] = ["3", "NaN", "", null, true, false, [], [5], {}, { a: 1 }];
const VALUES: unknown[] = [...NUMBERS, ...JUNK];
const FIELDS: string[] = [...ts.SEARCH_FIELDS, "bogus", "", "Title", "constructor", "__proto__"];
const KINDS: unknown[] = [...ts.SEARCH_KINDS, "bogus", "NOTE", "", 3, null];
const FLAGS = ["recencyBoost", "ignoreDiacritics", "ignoreArabicDiacritics"] as const;
const WEIGHT_VALUES = [0, 0.5, 1.5, 20, 1e6, -3, 25];

/** Arbitrary (possibly hostile) raw settings row, as read from the user-writable store. */
function randomRaw(rand: () => number): unknown {
  if (rand() < 0.1) return pick(rand, [undefined, null, "x", 3, NaN, true, [], [{}]]);
  const out: Record<string, unknown> = {};
  if (rand() < 0.7) {
    out.weights =
      rand() < 0.1
        ? pick(rand, JUNK)
        : Object.fromEntries(
            Array.from({ length: Math.floor(rand() * 8) }, () => [
              pick(rand, FIELDS),
              rand() < 0.4 ? rand() * 50 - 10 : pick(rand, VALUES),
            ]),
          );
  }
  if (rand() < 0.6) {
    out.downrankedKinds =
      rand() < 0.1
        ? pick(rand, JUNK)
        : Array.from({ length: Math.floor(rand() * 6) }, () => pick(rand, KINDS));
  }
  for (const flag of FLAGS) {
    if (rand() < 0.6) out[flag] = rand() < 0.7 ? rand() < 0.5 : pick(rand, JUNK);
  }
  return out;
}

const HOSTILE: unknown[] = [
  undefined, null, "weights", 0, NaN, [], [{ weights: { title: 3 } }], {},
  { weights: null }, { weights: [1, 2] }, { weights: {} },
  { weights: { title: NaN, aliases: Infinity, tags: -Infinity } },
  { weights: { title: -5, body: 99, path: 20.0000001, headings: 0 } },
  { weights: { title: "5", aliases: true, tags: null, path: [], body: {} } },
  { weights: { bogus: 4, constructor: 4, toString: 4 } },
  { downrankedKinds: "note" },
  { downrankedKinds: ["note", "note", "paper", "bogus", 3, null] },
  { downrankedKinds: [] },
  { downrankedKinds: ["bogus"] },
  { recencyBoost: "false", ignoreDiacritics: 0, ignoreArabicDiacritics: null },
  { recencyBoost: false },
  { ignoreDiacritics: true, ignoreArabicDiacritics: false },
  { weights: { title: 0 } },
  { weights: { title: 20, body: 20.5 } },
  JSON.parse('{"weights":{"__proto__":9,"title":2}}') as unknown,
];

test("normalizeSearchSettings matches TS on hostile and seeded input", () => {
  HOSTILE.forEach((raw, i) =>
    assertParity(
      `hostile ${i}`,
      () => ts.normalizeSearchSettings(raw),
      () => rs.normalizeSearchSettings(raw),
    ),
  );
  for (let seed = 1; seed <= 300; seed += 1) {
    const raw = randomRaw(random(seed));
    assertParity(
      `seed ${seed}`,
      () => ts.normalizeSearchSettings(raw),
      () => rs.normalizeSearchSettings(raw),
    );
  }
});

function randomWeights(rand: () => number): Weights {
  const weights: Weights = {};
  for (const field of ts.SEARCH_FIELDS) {
    if (rand() < 0.5) weights[field] = rand() < 0.5 ? pick(rand, WEIGHT_VALUES) : rand() * 30 - 5;
  }
  return weights;
}

// The Rust entry point normalizes what it is given (clamping weights to 0..20), as TS does when
// it reads stored settings; so the TS side gets the normalized settings it would really see.
test("effectiveFieldBoosts matches TS on typed settings", () => {
  assertParity(
    "no settings",
    () => ts.effectiveFieldBoosts(),
    () => rs.effectiveFieldBoosts(),
  );
  assertParity(
    "empty settings",
    () => ts.effectiveFieldBoosts({}),
    () => rs.effectiveFieldBoosts({}),
  );
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    const settings: Settings =
      rand() < 0.2 ? undefined : { weights: randomWeights(rand), recencyBoost: rand() < 0.5 };
    assertParity(
      `seed ${seed}`,
      () => ts.effectiveFieldBoosts(ts.normalizeSearchSettings(settings)),
      () => rs.effectiveFieldBoosts(settings as never),
    );
  }
});

test("kindMultiplier matches TS for every kind on seeded settings", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    const randomKinds = Array.from({ length: Math.floor(rand() * 6) }, () => pick(rand, ts.SEARCH_KINDS));
    const choices: Settings[] = [undefined, {}, { downrankedKinds: [] }, { downrankedKinds: randomKinds }];
    const settings = pick(rand, choices);
    for (const kind of ts.SEARCH_KINDS) {
      assertParity(
        `seed ${seed} ${kind}`,
        () => ts.kindMultiplier(kind, settings),
        () => rs.kindMultiplier(kind, settings as never),
      );
    }
  }
});

test("search settings constants match TS", () => {
  assert.deepEqual(
    canon({ min: rs.MIN_FIELD_WEIGHT, max: rs.MAX_FIELD_WEIGHT, downrank: rs.DOWNRANK_FACTOR }),
    canon({ min: ts.MIN_FIELD_WEIGHT, max: ts.MAX_FIELD_WEIGHT, downrank: ts.DOWNRANK_FACTOR }),
  );
});
