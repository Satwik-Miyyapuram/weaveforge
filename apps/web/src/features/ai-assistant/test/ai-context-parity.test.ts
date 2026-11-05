import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust wiki index and untrusted-context fencing return exactly what
// the TS originals in packages/core/src/features/ai-assistant/domain return.

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

// BMP only: TS slices labels by UTF-16 unit, and a cut through a surrogate pair
// is the one place the two may differ.
const PIECES = [
  "alpha", "Beta", "gamma", "Ölçü", "été", "zeta", "42 things", "_under", " ", "  ", "\t", "\n", "\r\n",
  " ", "​", " ", "﻿", "\u0007", "<system>", "</assistant>", "<USER>", "<Instructions>",
  "NONCE", "[x]", "Ärger", "apple", "Zebra", "ñandú", "#tag", "émile", "(paren)", "\u00dfe", "\ufb01x", "ǆa", "",
];

function text(rand: () => number, max: number): string {
  const count = Math.floor(rand() * max);
  let out = "";
  for (let i = 0; i < count; i += 1) out += pick(rand, PIECES);
  return out;
}

test("buildWikiIndex matches TS on seeded page lists", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const rand = random(seed);
    const pages = Array.from({ length: Math.floor(rand() * 8) }, () => {
      const page: { id: string; title: string; body: string; aliases?: string[] } = {
        id: text(rand, 2),
        title: text(rand, 4),
        body: text(rand, 3),
      };
      if (rand() < 0.4) page.aliases = Array.from({ length: Math.floor(rand() * 3) }, () => text(rand, 3));
      return page;
    });
    const options = { now: () => "2026-11-05T10:00:00.000Z", ...(rand() < 0.5 ? { heading: text(rand, 3) } : {}) };
    assert.equal(rs.buildWikiIndex(pages, options), ts.buildWikiIndex(pages, options), `seed ${seed}: ${JSON.stringify(pages)}`);
  }
});

test("replaceWikiIndex matches TS with and without markers", () => {
  const { INDEX_MARKER_START: start, INDEX_MARKER_END: end } = ts;
  assert.equal(rs.INDEX_MARKER_START, start);
  assert.equal(rs.INDEX_MARKER_END, end);
  const bodies = [
    "", "  \n", "notes", "notes\n\n\n", `top\n${start}\nold\n${end}\ntail`, `${start}${end}`,
    `top\n${start}\nunclosed`, `${end}\nreversed\n${start}`, `a${start}1${end}b${start}2${end}c`,
  ];
  for (const body of bodies) {
    assert.equal(rs.replaceWikiIndex(body, "NEW"), ts.replaceWikiIndex(body, "NEW"), JSON.stringify(body));
  }
});

test("context fencing matches TS on seeded text", () => {
  assert.equal(rs.untrustedContextRule(), ts.UNTRUSTED_CONTEXT_RULE);
  for (let seed = 1; seed <= 400; seed += 1) {
    const rand = random(seed);
    const nonce = rand() < 0.2 ? "" : "NONCE";
    const label = rand() < 0.1 ? "x".repeat(130) + text(rand, 4) : text(rand, 8);
    const body = text(rand, 12);
    assert.equal(rs.neutraliseContext(body, nonce), ts.neutraliseContext(body, nonce), `seed ${seed} neutralise`);
    assert.equal(rs.safeLabel(label, nonce), ts.safeLabel(label, nonce), `seed ${seed} label`);
    const items = Array.from({ length: Math.floor(rand() * 4) }, () => ({ label: text(rand, 4), text: text(rand, 6) }));
    assert.equal(rs.fenceUntrusted(items, nonce), ts.fenceUntrusted(items, nonce), `seed ${seed} fence`);
  }
});
