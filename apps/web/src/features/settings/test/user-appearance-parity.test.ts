import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust appearance normalizer returns exactly what the TS original in
// packages/core/src/features/settings/domain/user-appearance.ts returns.
// Inputs are plain JSON, as the stored settings row is.

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

const JUNK: unknown[] = [null, "", "x", true, false, 0, 1, 2.5, [], {}];
const TEMPLATE: unknown = JSON.parse(ts.themeConfigTemplate());

const VALUES: Record<string, unknown[]> = {
  mode: ["light", "dark", "Dark", " light", "neon"],
  lightTheme: ["brutal", "  crt  ", "   ", " paper ", "﻿x"],
  darkTheme: ["crt", "dark ", "", "\t\n"],
  controlSize: ["compact", "default", "comfortable", "huge", "Compact"],
  surfaces: ["borderless", "bordered", "none"],
  reactiveMotion: [true, false, "true"],
  animationSpeed: [0.25, 0.5, 1, 2, 4, 3, 0, -1, "2", 1.0000001],
  cardTint: ["full", "bar", "border", "none", "Bar"],
  cardTilt: [true, false, "false"],
  scanlines: [true, false, 0],
  customTheme: [null, TEMPLATE, { mode: "neon" }, { name: "x" }, "theme"],
};

function appearance(rand: () => number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, values] of Object.entries(VALUES)) {
    const roll = rand();
    if (roll < 0.45) continue;
    out[key] = roll < 0.9 ? pick(rand, values) : pick(rand, JUNK);
  }
  if (rand() < 0.2) out.extra = pick(rand, JUNK);
  return out;
}

test("normalizeAppearance matches TS on seeded appearances", () => {
  for (let seed = 1; seed <= 800; seed += 1) {
    const raw = appearance(random(seed));
    assert.deepEqual(rs.normalizeAppearance(raw), ts.normalizeAppearance(raw), `seed ${seed}: ${JSON.stringify(raw)}`);
  }
});

test("normalizeAppearance matches TS on non-objects and edges", () => {
  const edges: unknown[] = [
    undefined, ...JUNK, "dark", [{ mode: "dark" }], { customTheme: null }, { customTheme: undefined },
    { mode: "dark", customTheme: { mode: "neon" } }, { lightTheme: "  ", darkTheme: "" },
  ];
  for (const raw of edges) {
    assert.deepEqual(rs.normalizeAppearance(raw), ts.normalizeAppearance(raw), JSON.stringify(raw) ?? "undefined");
  }
});

test("normalizeAppearance keeps the TS key order", () => {
  const raw = Object.fromEntries(Object.entries(VALUES).map(([key, values]) => [key, values[0]]).reverse());
  assert.deepEqual(Object.keys(rs.normalizeAppearance(raw) ?? {}), Object.keys(ts.normalizeAppearance(raw) ?? {}));
});
