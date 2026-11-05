import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust user settings row helpers return exactly what the TS originals in
// packages/core/src/features/settings/domain/user-settings.ts and
// user-integration-credentials.ts (applyUserIntegrationFields) return.

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

/** JSON round trip; a top-level `undefined` becomes `null`, as the wasm wrapper does. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value) ?? "null") as unknown;

/** Recursively sorted keys, so key order does not matter. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortKeys(record[key])]));
  }
  return value;
}

const canon = (value: unknown): unknown => sortKeys(plain(value));

type Settings = Parameters<typeof ts.normalizeUserSettings>[0];
type Outcome = { ok: true; value: unknown } | { ok: false };

function attempt(run: () => unknown): Outcome {
  try {
    return { ok: true, value: run() };
  } catch {
    return { ok: false };
  }
}

/** Both sides on the same input: equal canonical output, or both throw. */
function assertSame(tsRun: () => unknown, rsRun: () => unknown, label: string): void {
  const tsOut = attempt(() => canon(tsRun()));
  const rsOut = attempt(() => canon(rsRun()));
  assert.equal(rsOut.ok, tsOut.ok, `${label}: throw parity`);
  if (tsOut.ok && rsOut.ok) assert.deepEqual(rsOut.value, tsOut.value, label);
}

const STRINGS = ["", " ", " ", "﻿", "\n", " key ", "key", " lib ", "🙂", "é"];
const PROVIDERS = ["zotero", "semantic-scholar", "github"];
const FIELDS = ["apiKey", "library", "token"];
const ACCEPTED = [undefined, "", "2026-11-05T10:00:00.000Z", 0, 1];
const VERSIONS = [undefined, 0, 1, 2, 1.5, -1, "2", Number.NaN, 1e21];
const APPEARANCES = [undefined, null, {}, { controlSize: "compact" }, "dark"];
const AI_ACCESS = [
  undefined,
  null,
  {},
  { enabled: true, readCategories: ["notes", "bogus"] },
  { enabled: "yes" },
  "on",
];
const SEARCH = [undefined, {}, { recencyBoost: false }, { weights: { title: 3 } }];

/** A random provider bag map; bags are never null, as TS throws on them. */
function integrations(rand: () => number): unknown {
  const roll = rand();
  if (roll < 0.15) return undefined;
  if (roll < 0.25) return null;
  if (roll < 0.35) return {};
  const out: Record<string, Record<string, string | null>> = {};
  for (const provider of PROVIDERS) {
    if (rand() < 0.4) continue;
    out[provider] = Object.fromEntries(
      FIELDS.filter(() => rand() < 0.5).map((field) => [field, rand() < 0.1 ? null : pick(rand, STRINGS)]),
    );
  }
  return out;
}

/** A random settings row: legacy columns are strings, other fields any shape. */
function settings(rand: () => number): Settings {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) out[key] = value;
  };
  if (rand() < 0.5) out.zoteroApiKey = pick(rand, STRINGS);
  if (rand() < 0.5) out.zoteroLibrary = pick(rand, STRINGS);
  if (rand() < 0.5) out.semanticScholarKey = pick(rand, STRINGS);
  set("integrations", integrations(rand));
  set("disclaimerAcceptedAt", pick(rand, ACCEPTED));
  set("disclaimerVersion", pick(rand, VERSIONS));
  set("appearance", pick(rand, APPEARANCES));
  set("aiAccess", pick(rand, AI_ACCESS));
  set("search", pick(rand, SEARCH));
  if (rand() < 0.2) out.unknownKey = "kept?";
  return out as Settings;
}

test("hydrateUserSettings matches TS on seeded rows", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const input = settings(random(seed));
    assertSame(() => ts.hydrateUserSettings(input), () => rs.hydrateUserSettings(input as never), `seed ${seed}`);
  }
});

test("normalizeUserSettings matches TS on seeded rows", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const input = settings(random(seed));
    assertSame(() => ts.normalizeUserSettings(input), () => rs.normalizeUserSettings(input as never), `seed ${seed}`);
  }
});

test("applyUserIntegrationFields matches TS for every provider", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    const input = settings(rand);
    const provider = pick(rand, PROVIDERS);
    const fields = Object.fromEntries(FIELDS.filter(() => rand() < 0.6).map((field) => [field, pick(rand, STRINGS)]));
    assertSame(
      () => ts.applyUserIntegrationFields(input, provider, fields),
      () => rs.applyUserIntegrationFields(input as never, provider, fields),
      `seed ${seed} ${provider}`,
    );
  }
});

test("disclaimer version keeps only positive integers", () => {
  for (const version of VERSIONS) {
    const input = { disclaimerVersion: version } as unknown as Settings;
    assertSame(() => ts.normalizeUserSettings(input), () => rs.normalizeUserSettings(input as never), `version ${String(version)}`);
  }
});
