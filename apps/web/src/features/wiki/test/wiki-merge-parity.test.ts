import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust wiki page merge returns exactly what the TS original in
// packages/core/src/features/ai-assistant/domain/wiki-merge.ts returns.

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
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value) ?? "null") as unknown;

type Input = Parameters<typeof ts.mergeWikiPages>[0];
type Outcome = { ok: true; value: unknown } | { ok: false };

function attempt(run: () => unknown): Outcome {
  try {
    return { ok: true, value: run() };
  } catch {
    return { ok: false };
  }
}

/** Runs both sides on the same pages and compares output, or that both threw. */
function assertSameMerge(primary: Input, secondary: Input, label: string): void {
  const tsOut = attempt(() => plain(ts.mergeWikiPages(primary, secondary)));
  const rsOut = attempt(() => plain(rs.mergeWikiPages(primary as never, secondary as never)));
  assert.equal(rsOut.ok, tsOut.ok, `${label}: throw parity`);
  if (tsOut.ok && rsOut.ok) assert.deepEqual(rsOut.value, tsOut.value, label);
}

const TITLES = ["Caching", "Cache Notes", "caching", "  Batch  ", "", "Ölçü", "émile", "ALPHA"];
const SENTENCES = [
  "The model is faster with caching.",
  "The model is not faster with caching.",
  "Caching never helps the model.",
  "Batch size matters for throughput.",
  "Batch size doesn't matter for throughput.",
  "Batch size matters for throughput. Warmup is cheap.",
  "e.g. the cache is warm.",
  "Version 1.5 is stable.",
  "Dr. Smith said it works.",
  "Hello! Is this nothing?",
  "What is it? Nobody knows.",
  "knot tying is a skill.",
  "énot is not a word.",
  "Nothing changed here.",
  "- bullet one. Two items",
  "1. Numbered item",
  "# Heading line",
  "> quoted line. Next",
  "lowercase after. continues here",
  "émile works fast. Ölçü ßtest 🙂 ǆ text.",
  "without caching the model lags.",
  "Accuracy decreases with noise.",
  "Accuracy does not decrease with noise.",
  "   ",
  "",
];
const SEPARATORS = [" ", "  ", "\n", "\n\n", " \n\n", "\n \n", "\t", " ", " ", "﻿", "\n\n\n"];
const HEADS = ["", "---\ntags: x\n---\n", "---\nunclosed\n", "------\n", "\n---\ntags: y\n---\n", "---"];

function body(rand: () => number): string {
  let text = pick(rand, HEADS);
  const count = Math.floor(rand() * 6);
  for (let i = 0; i < count; i += 1) {
    if (i > 0) text += pick(rand, SEPARATORS);
    text += pick(rand, SENTENCES);
  }
  return rand() < 0.3 ? `${text}\n` : text;
}

const list = (rand: () => number, make: (i: number) => string): string[] =>
  Array.from({ length: Math.floor(rand() * 4) }, (_, i) => make(i));

function page(rand: () => number, id: string): Input {
  return {
    id,
    title: pick(rand, TITLES),
    body: body(rand),
    ...(rand() < 0.5 ? { aliases: list(rand, () => pick(rand, TITLES)) } : {}),
    ...(rand() < 0.5 ? { sources: list(rand, (i) => `src${i % 2}`) } : {}),
  };
}

test("mergeWikiPages matches TS on seeded pages", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const rand = random(seed);
    assertSameMerge(page(rand, "a"), page(rand, "b"), `seed ${seed}`);
  }
});

test("mergeWikiPages matches TS on contradiction-heavy seeded pages", () => {
  const pool = SENTENCES.filter((s) => /model|cach|Batch|noise/.test(s));
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    const make = (id: string): Input => ({ id, title: pick(rand, TITLES), body: pick(rand, pool) + " " + pick(rand, pool) });
    assertSameMerge(make("a"), make("b"), `seed ${seed}`);
  }
});

test("negation words respect word boundaries, case and Unicode neighbours", () => {
  const base = "The model is faster with caching.";
  const variants = [
    "The model is not faster with caching.",
    "The model is NOT faster with caching.",
    "The model is Not faster with caching.",
    "The model is nothing faster with caching.",
    "The model is knot faster with caching.",
    "The model is énot faster with caching.",
    "The model is isn't faster with caching.",
    "The model isn't faster with caching.",
    "The model isn’t faster with caching.",
    "The model is faster without caching.",
    "The model is faster with caching fails.",
    "The model is notable faster with caching.",
    "The model is lower faster with caching.",
    "The model is ſlower faster with caching.",
  ];
  for (const variant of variants) {
    assertSameMerge(page0("Caching", base), page0("Cache Notes", variant), variant);
  }
});

test("statement splitting handles abbreviations, decimals, newlines and bullets", () => {
  const primary = "Dr. Smith measured 1.5 units. Done.\n\nThe model is faster with caching.";
  const secondaries = [
    "Dr. Smith measured 1.5 units. Warmup is cheap.\n\nNew para. e.g. another",
    "The model is not faster with caching!\nThe model is not faster with caching?",
    "- The model is not faster with caching.\n- Batch size matters.\n* lone star",
    "1.5 is not faster. Two. three. Four is not here.",
    "Line one.\nLine two is not faster with caching.\r\nEnd",
    "A.B. C. d. E is not faster with caching.",
    "   \n\n  Leading space. Then Upper.",
  ];
  for (const secondary of secondaries) {
    assertSameMerge(page0("Caching", primary), page0("Other", secondary), secondary);
  }
});

test("front matter: present, absent, unclosed and inline dashes", () => {
  const bodies = ["---\ntags: a\n---\nKept line.", "---\nno closing\nKept.", "------\nX.", "---", "\n---\ntags: y\n---\nNot stripped. Kept.", "---\n# Heading\n---\n> quoted\n\nKept line.", "--- not front matter --- Kept."];
  for (const secondary of bodies) assertSameMerge(page0("A", ""), page0("B", secondary), secondary);
});

test("duplicate statements in the primary and the secondary collapse", () => {
  assertSameMerge(
    page0("A", "Batch size matters. Batch size matters."),
    page0("B", "Batch size matters for throughput. Batch size matters for throughput."),
    "dup",
  );
});

test("empty pages, empty titles and alias edge cases", () => {
  assertSameMerge(page0("", ""), page0("", ""), "empty both");
  assertSameMerge(page0("", "Only body. Here."), page0("Alpha", ""), "empty title primary");
  assertSameMerge(page0("Alpha", ""), page0("", ""), "empty title secondary");
  const withAliases: Input = { id: "p", title: "Alpha", body: "", aliases: ["Cache", "cache", " ALPHA ", "Beta", "Beta"], sources: ["s1", "s1", "s2"] };
  const other: Input = { id: "s", title: "alpha", body: "", aliases: [], sources: ["s2"] };
  assertSameMerge(withAliases, other, "aliases");
  assertSameMerge(other, withAliases, "aliases rev");
});

function page0(title: string, text: string): Input {
  return { id: title, title, body: text };
}
