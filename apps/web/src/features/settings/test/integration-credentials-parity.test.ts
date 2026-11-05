import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust provider credential helpers return exactly what the TS originals in
// packages/core/src/features/settings/domain/user-integration-credentials.ts return.
// applyUserIntegrationFields is not ported, so it is not tested here.

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

/** Recursively sorted keys, so bag key order does not matter. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortKeys(record[key])]));
  }
  return value;
}

const canon = (value: unknown): unknown => sortKeys(plain(value));

type Settings = Parameters<typeof ts.getUserIntegrationField>[0];
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

const PROVIDERS = ["zotero", "semantic-scholar", "unknown", "", " zotero", "Zotero", "semantic-scholar "];
const FIELDS = ["apiKey", "library", "other", "", " apiKey", "APIKEY"];
const VALUES = [
  "",
  " ",
  " ",
  " ",
  "﻿",
  "\n",
  "\t \n",
  " token ",
  "tok ",
  "ǆ key",
  "ß",
  "🙂",
  "é",
  "0",
  "-1",
  "1.5",
];
const WRONG = [null, 0, -1, 1.5, 1e21, true, [], ["x"], {}, { apiKey: "x" }];

/** Settings with a random bag and random legacy columns, all string-typed. */
function settings(rand: () => number): Settings {
  const out: Record<string, unknown> = {};
  if (rand() < 0.7) {
    const bags: Record<string, Record<string, string>> = {};
    for (const provider of PROVIDERS) {
      if (rand() < 0.5) continue;
      bags[provider] = Object.fromEntries(
        FIELDS.filter(() => rand() < 0.5).map((field) => [field, pick(rand, VALUES)]),
      );
    }
    out.integrations = bags;
  }
  if (rand() < 0.6) out.zoteroApiKey = pick(rand, VALUES);
  if (rand() < 0.6) out.zoteroLibrary = pick(rand, VALUES);
  if (rand() < 0.6) out.semanticScholarKey = pick(rand, VALUES);
  return out as Settings;
}

test("getUserIntegrationField matches TS on seeded settings", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const rand = random(seed);
    const input = settings(rand);
    for (const provider of PROVIDERS) {
      for (const field of FIELDS) {
        assertSame(
          () => ts.getUserIntegrationField(input, provider, field),
          () => rs.getUserIntegrationField(input, provider, field),
          `seed ${seed} ${provider}/${field}`,
        );
      }
    }
  }
});

test("isUserIntegrationConnected matches TS on seeded field lists", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    const input = settings(rand);
    const fieldIds = FIELDS.filter(() => rand() < 0.5);
    const provider = pick(rand, PROVIDERS);
    assertSame(
      () => ts.isUserIntegrationConnected(input, provider, fieldIds),
      () => rs.isUserIntegrationConnected(input, provider, fieldIds),
      `seed ${seed}`,
    );
  }
});

test("integrationsBagFromLegacy matches TS on seeded settings, keys sorted", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const input = settings(random(seed));
    assertSame(
      () => ts.integrationsBagFromLegacy(input),
      () => rs.integrationsBagFromLegacy(input),
      `seed ${seed}`,
    );
  }
});

test("empty, whitespace-only and Unicode-space values fall back like TS", () => {
  for (const value of VALUES) {
    const legacy = { zoteroApiKey: value, zoteroLibrary: value, semanticScholarKey: value } as unknown as Settings;
    const bagged = { integrations: { zotero: { apiKey: value } } } as unknown as Settings;
    assertSame(() => ts.getUserIntegrationField(legacy, "zotero", "apiKey"), () => rs.getUserIntegrationField(legacy, "zotero", "apiKey"), `legacy ${JSON.stringify(value)}`);
    assertSame(() => ts.getUserIntegrationField(bagged, "zotero", "apiKey"), () => rs.getUserIntegrationField(bagged, "zotero", "apiKey"), `bag ${JSON.stringify(value)}`);
    assertSame(() => ts.integrationsBagFromLegacy(legacy), () => rs.integrationsBagFromLegacy(legacy), `bag-legacy ${JSON.stringify(value)}`);
  }
});

test("whitespace-only and unknown provider or field names resolve to nothing", () => {
  const input = {
    integrations: { "": { "": "x" }, " zotero": { apiKey: "x" }, "semantic-scholar ": { apiKey: "y" } },
    zoteroApiKey: "legacy",
  } as unknown as Settings;
  for (const provider of PROVIDERS) {
    for (const field of FIELDS) {
      assertSame(() => ts.getUserIntegrationField(input, provider, field), () => rs.getUserIntegrationField(input, provider, field), `${provider}/${field}`);
    }
  }
  assertSame(() => ts.isUserIntegrationConnected(input, " ", [""]), () => rs.isUserIntegrationConnected(input, " ", [""]), "blank names");
});

test("legacy columns holding non-string values: TS ignores them, Rust must too", () => {
  for (const wrong of WRONG) {
    const legacy = { zoteroApiKey: wrong, zoteroLibrary: "lib", semanticScholarKey: wrong } as unknown as Settings;
    assertSame(() => ts.getUserIntegrationField(legacy, "zotero", "apiKey"), () => rs.getUserIntegrationField(legacy, "zotero", "apiKey"), `legacy ${JSON.stringify(wrong)}`);
    assertSame(() => ts.integrationsBagFromLegacy(legacy), () => rs.integrationsBagFromLegacy(legacy), `bag ${JSON.stringify(wrong)}`);
  }
});

test("bag entries holding non-string values: TS throws or skips, Rust must match", () => {
  for (const wrong of WRONG) {
    const bagged = { integrations: { zotero: { apiKey: wrong } }, zoteroApiKey: "legacy" } as unknown as Settings;
    assertSame(() => ts.getUserIntegrationField(bagged, "zotero", "apiKey"), () => rs.getUserIntegrationField(bagged, "zotero", "apiKey"), `bag ${JSON.stringify(wrong)}`);
    const wrongBag = { integrations: { zotero: wrong } } as unknown as Settings;
    assertSame(() => ts.getUserIntegrationField(wrongBag, "zotero", "apiKey"), () => rs.getUserIntegrationField(wrongBag, "zotero", "apiKey"), `bag-provider ${JSON.stringify(wrong)}`);
  }
});
