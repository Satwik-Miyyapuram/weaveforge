// Proves the Rust `createPaperRelation` (wf-core relations::paper_relation, via the wasm wrapper)
// accepts and rejects the same inputs as the TS original in
// packages/core/src/features/relations/domain/paper-relation.ts, and builds the same record.

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

type Input = Parameters<typeof ts.createPaperRelation>[0];

// Fixed clock and id generator: both sides receive the same values.
const deps = {
  clock: { nowIso: () => "2026-11-05T00:00:00.000Z" },
  ids: { newId: () => "rel-fixed" },
};

type Outcome = { ok: true; value: unknown } | { ok: false; message: string };

function run(fn: () => unknown): Outcome {
  try {
    return { ok: true, value: plain(fn()) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Same ok flag always. Messages are compared only for validation errors the wrapper
 * produces itself; an unknown relation fails at the wasm boundary with its own message.
 */
function assertSame(rsOut: Outcome, tsOut: Outcome, label: string, compareMessage: boolean): void {
  assert.equal(rsOut.ok, tsOut.ok, label);
  if (rsOut.ok && tsOut.ok) {
    assert.deepEqual(rsOut.value, tsOut.value, label);
  } else if (!rsOut.ok && !tsOut.ok && compareMessage) {
    assert.equal(rsOut.message, tsOut.message, label);
  }
}

// Non-empty but blank-looking ids are valid in TS (only "" is falsy); the port must agree.
const PAPERS = ["a", "b", "", " ", " ", " ", "﻿p", "é", "ǆ", "🙂", "p-1", "P-1"];
const KINDS = ["cites", "extends", "contradicts", "similar", "builds_on", "uses_method"] as const;
const NOTES = [undefined, "", " kept as is ", "\n", "line\nbreak", "émile 🙂"];
const SOURCES = [undefined, "manual", "auto"] as const;

test("createPaperRelation matches TS on seeded inputs (valid, blank, self, unknown kind)", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const rand = random(seed);
    const known = rand() < 0.9;
    const input = {
      fromPaper: pick(rand, PAPERS),
      toPaper: rand() < 0.2 ? undefined : pick(rand, PAPERS),
      relation: known ? pick(rand, KINDS) : pick(rand, ["cited", "CITES", "", "cites "] as const),
      note: pick(rand, NOTES),
      source: pick(rand, SOURCES),
    } as unknown as Input;
    const compareMessage = known;
    assertSame(
      run(() => rs.createPaperRelation(input, deps)),
      run(() => ts.createPaperRelation(input, deps)),
      `seed ${seed}`,
      compareMessage,
    );
  }
});

test("createPaperRelation: empty paper ids throw in both, with the same message", () => {
  const cases: [string, string][] = [["", "b"], ["a", ""], ["", ""]];
  for (const [fromPaper, toPaper] of cases) {
    const input: Input = { fromPaper, toPaper, relation: "cites" };
    assertSame(run(() => rs.createPaperRelation(input, deps)), run(() => ts.createPaperRelation(input, deps)), `${fromPaper}/${toPaper}`, true);
  }
});

test("createPaperRelation: whitespace and NBSP ids are not blank, both accept", () => {
  for (const id of [" ", " ", " ", "﻿"]) {
    const input: Input = { fromPaper: id, toPaper: "b", relation: "similar" };
    const tsOut = run(() => ts.createPaperRelation(input, deps));
    assert.equal(tsOut.ok, true, `TS accepts ${JSON.stringify(id)}`);
    assertSame(run(() => rs.createPaperRelation(input, deps)), tsOut, JSON.stringify(id), true);
  }
});

test("createPaperRelation: self relation throws in both, including whitespace-equal ids", () => {
  for (const id of ["a", " ", "é"]) {
    const input: Input = { fromPaper: id, toPaper: id, relation: "extends" };
    assertSame(run(() => rs.createPaperRelation(input, deps)), run(() => ts.createPaperRelation(input, deps)), JSON.stringify(id), true);
  }
  // Case and Unicode-normalised forms are different ids, not self relations.
  const distinct: Input = { fromPaper: "é", toPaper: "é", relation: "extends" };
  assertSame(run(() => rs.createPaperRelation(distinct, deps)), run(() => ts.createPaperRelation(distinct, deps)), "NFC vs NFD", true);
});

test("createPaperRelation: unknown relation kind throws in both", () => {
  const input = { fromPaper: "a", toPaper: "b", relation: "cited" } as unknown as Input;
  const tsOut = run(() => ts.createPaperRelation(input, deps));
  assert.equal(tsOut.ok, false, "TS rejects unknown kind");
  assertSame(run(() => rs.createPaperRelation(input, deps)), tsOut, "unknown kind", false);
});

test("createPaperRelation: note is kept verbatim (no trim), empty note kept, source defaults to manual", () => {
  for (const note of ["", " kept ", " x ", "line\nbreak"]) {
    const input: Input = { fromPaper: "a", toPaper: "b", relation: "builds_on", note };
    assertSame(run(() => rs.createPaperRelation(input, deps)), run(() => ts.createPaperRelation(input, deps)), JSON.stringify(note), true);
  }
  const bare: Input = { fromPaper: "a", toPaper: "b", relation: "builds_on" };
  assertSame(run(() => rs.createPaperRelation(bare, deps)), run(() => ts.createPaperRelation(bare, deps)), "bare", true);
});

test("createPaperRelation: invalid input checks happen before deps are called", () => {
  let drawn = 0;
  const counting = {
    clock: { nowIso: () => { drawn += 1; return "t"; } },
    ids: { newId: () => { drawn += 1; return "id"; } },
  };
  const bad: Input = { fromPaper: "", toPaper: "b", relation: "cites" };
  assert.equal(run(() => ts.createPaperRelation(bad, counting)).ok, false);
  assert.equal(run(() => rs.createPaperRelation(bad, counting)).ok, false);
  assert.equal(drawn, 0, "no id or clock draw on rejected input");
});
