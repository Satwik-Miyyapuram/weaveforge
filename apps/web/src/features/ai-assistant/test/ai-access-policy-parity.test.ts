import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust AI access policy and settings normaliser decide exactly as the TS originals
// in packages/core/src/features/ai-assistant/domain/ai-access-policy.ts and ai-settings.ts.

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

/** Value or thrown, so both sides can be compared on whether they throw. */
type Outcome = { ok: true; value: unknown } | { ok: false };
function outcome(run: () => unknown): Outcome {
  try {
    return { ok: true, value: plain(run()) };
  } catch {
    return { ok: false };
  }
}

function assertSame(rsRun: () => unknown, tsRun: () => unknown, label: string): void {
  const expected = outcome(tsRun);
  const actual = outcome(rsRun);
  assert.equal(actual.ok, expected.ok, `${label}: throw parity`);
  if (expected.ok && actual.ok) assert.deepEqual(actual.value, expected.value, label);
}

type Input = Parameters<ts.AiAccessPolicy["evaluate"]>[0];
type Persisted = NonNullable<Parameters<typeof ts.normalizeAiAccessSettings>[0]>;

const NOW = "2026-11-05T10:00:00.000Z";
/**
 * Grant dates and clocks: equal instants, date-only, invalid, and JS-legacy forms.
 * Left out on purpose: zone-less date-times (V8 reads them in the machine's local zone) and
 * Feb 30 (V8 rolls it to Mar 2; Rust fails closed). The app only stores `toISOString()` dates.
 */
const DATES = [
  "2099-01-01T00:00:00.000Z", NOW, "2026-11-05T10:00:00.001Z", "2026-11-05T09:59:59.999Z",
  "2026-11-05T12:00:00+02:00", "2026-11-05T12:00:01+02:00", "2026-11-05T10:00Z", "2026-11-05T10:00:00.5Z",
  "2026-11-05", "2026-11-06",
  "2024-02-29T00:00:00Z", "2026-11-05 10:00:00Z", "2026-13-01T00:00:00Z",
  "2026-11-05T25:00:00Z", "not-a-date", "",
];
const NOWS = [NOW, "2026-11-05", "2026-11-05 10:00:00Z", "", "garbage"];
const DISCLOSURES = [
  "", "   ", "  2026-01-01  ", "2026-01-01T00:00:00.000Z", " 2026-01-01 ",
  " x ", "﻿2026-01-01﻿", "​2026", "\n\t2026\r\n",
];
const CATEGORY_POOL: string[] = [...ts.AI_READ_CATEGORIES, "nope", "Logbook", "", "__proto__", "toString"];
const KIND_POOL: string[] = [...ts.AI_PROPOSAL_KINDS, "nope", "Paper_Update", "constructor"];

/** A fully allowed request; each test changes one thing. */
function base(): Input {
  return {
    settings: {
      enabled: true,
      disclosureAcceptedAt: "2026-01-01T00:00:00.000Z",
      readCategories: [...ts.AI_READ_CATEGORIES],
      proposalKinds: [...ts.AI_PROPOSAL_KINDS],
    },
    grant: {
      id: "g1",
      workspaceId: "w1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      readable: [{ sourceId: "s1", resourceType: "paper", resourceId: "p1" }],
      allowedTools: ["search_workspace"],
      proposalCapabilities: ["append_paper_note"],
      requiresConfirmationForWrites: true,
    },
    tool: "search_workspace",
    encryptionUnlocked: true,
    resourceType: "paper",
    resourceId: "p1",
    now: NOW,
  };
}

function randomInput(rand: () => number): Input {
  const subset = <T>(items: readonly T[], keep: number): T[] => items.filter(() => rand() < keep);
  return {
    settings: {
      enabled: rand() < 0.85,
      ...(rand() < 0.8 ? { disclosureAcceptedAt: pick(rand, DISCLOSURES) } : {}),
      readCategories: subset(ts.AI_READ_CATEGORIES, 0.7),
      proposalKinds: subset(ts.AI_PROPOSAL_KINDS, 0.5),
      ...(rand() < 0.5 ? { autoIncludeNewSourceCategories: subset(ts.AI_READ_CATEGORIES, 0.5) } : {}),
    },
    grant: {
      id: "g",
      workspaceId: "w",
      expiresAt: pick(rand, DATES),
      readable: Array.from({ length: Math.floor(rand() * 4) }, (_, i) => ({
        sourceId: `s${i}`,
        resourceType: pick(rand, ts.AI_RESOURCE_TYPES),
        resourceId: pick(rand, ["p1", "p2", ""]),
        ...(rand() < 0.5 ? { label: "L" } : {}),
      })),
      allowedTools: subset(ts.AI_TOOL_NAMES, 0.6),
      proposalCapabilities: subset(ts.AI_PROPOSAL_KINDS, 0.4),
      requiresConfirmationForWrites: true,
    },
    tool: pick(rand, ts.AI_TOOL_NAMES),
    encryptionUnlocked: rand() < 0.9,
    ...(rand() < 0.7 ? { resourceType: pick(rand, ts.AI_RESOURCE_TYPES) } : {}),
    ...(rand() < 0.8 ? { resourceId: pick(rand, ["p1", "p2", ""]) } : {}),
    ...(rand() < 0.3 ? { proposalKind: pick(rand, ts.AI_PROPOSAL_KINDS) } : {}),
    now: pick(rand, NOWS),
  };
}

function randomList(rand: () => number, pool: readonly string[]): string[] {
  return Array.from({ length: Math.floor(rand() * 6) }, () => pick(rand, pool));
}

test("evaluate matches TS on every grant date paired with every clock", () => {
  const policy = new ts.AiAccessPolicy();
  const rsPolicy = new rs.AiAccessPolicy();
  for (const expiresAt of DATES) {
    for (const now of NOWS) {
      const input: Input = { ...base(), grant: { ...base().grant, expiresAt }, now };
      assertSame(() => rsPolicy.evaluate(input as never), () => policy.evaluate(input), `${expiresAt} @ ${now}`);
    }
  }
});

test("evaluate matches TS on seeded settings, grants and requests", () => {
  const policy = new ts.AiAccessPolicy();
  const rsPolicy = new rs.AiAccessPolicy();
  for (let seed = 1; seed <= 300; seed += 1) {
    const input = randomInput(random(seed));
    assertSame(() => rsPolicy.evaluate(input as never), () => policy.evaluate(input), `seed ${seed}`);
  }
});

test("evaluate throws on both sides when a required grant list is missing", () => {
  // Outside the type on purpose: a broken grant must fail loudly, not allow.
  const broken = { ...base(), grant: { ...base().grant, allowedTools: undefined } } as unknown as Input;
  assert.equal(outcome(() => new ts.AiAccessPolicy().evaluate(broken)).ok, false, "TS throws");
  assertSame(
    () => new rs.AiAccessPolicy().evaluate(broken as never),
    () => new ts.AiAccessPolicy().evaluate(broken),
    "missing allowedTools",
  );
});

test("normalizeAiAccessSettings matches TS for missing and empty input", () => {
  assertSame(() => rs.normalizeAiAccessSettings(), () => ts.normalizeAiAccessSettings(), "no input");
  assertSame(() => rs.normalizeAiAccessSettings({}), () => ts.normalizeAiAccessSettings({}), "empty object");
});

test("normalizeAiAccessSettings trims disclosure the way JS trim does", () => {
  for (const value of DISCLOSURES) {
    const input: Persisted = { disclosureAcceptedAt: value };
    assertSame(() => rs.normalizeAiAccessSettings(input as never), () => ts.normalizeAiAccessSettings(input), JSON.stringify(value));
  }
});

test("normalizeAiAccessSettings matches TS on seeded persisted settings", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    // Persisted JSON can hold values the type does not allow; the normaliser must drop them.
    const raw = {
      ...(rand() < 0.8 ? { enabled: rand() < 0.5 } : {}),
      ...(rand() < 0.8 ? { disclosureAcceptedAt: pick(rand, DISCLOSURES) } : {}),
      ...(rand() < 0.8 ? { readCategories: randomList(rand, CATEGORY_POOL) } : {}),
      ...(rand() < 0.8 ? { proposalKinds: randomList(rand, KIND_POOL) } : {}),
      ...(rand() < 0.5 ? { autoIncludeNewSourceCategories: randomList(rand, CATEGORY_POOL) } : {}),
    } as unknown as Persisted;
    assertSame(() => rs.normalizeAiAccessSettings(raw as never), () => ts.normalizeAiAccessSettings(raw), `seed ${seed}`);
  }
});

test("constants and aiReadCategoryForResource match TS for every resource type", () => {
  assert.deepEqual(plain(rs.AI_READ_CATEGORIES), plain(ts.AI_READ_CATEGORIES));
  assert.deepEqual(plain(rs.AI_PROPOSAL_KINDS), plain(ts.AI_PROPOSAL_KINDS));
  assert.deepEqual(plain(rs.AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS), plain(ts.AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS));
  for (const type of ts.AI_RESOURCE_TYPES) {
    assertSame(() => rs.aiReadCategoryForResource(type), () => ts.aiReadCategoryForResource(type), type);
  }
});
