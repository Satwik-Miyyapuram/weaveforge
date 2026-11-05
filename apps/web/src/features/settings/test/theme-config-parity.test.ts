import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust theme config parser returns exactly what the TS original in
// packages/core/src/features/settings/domain/theme-config.ts returns.
// Left out on purpose: numbers outside f64 (1e400), lone surrogates, nesting deeper
// than serde's limit, and names whose 60-unit cut splits a surrogate pair.

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

const JUNK: unknown[] = [null, "x", "", true, 3, [], {}, 0.5];

const COLORS: unknown[] = [
  "#fff", "#FFFFFF", "#12345678", "#abcd", "#12", "#ggg", " #AbC ", "red", "White",
  "transparent", "currentColor", "rgb(1, 2, 3)", "rgba(1,2,3,0.5)", "hsl(10deg  20%   30%)",
  "HSLA( 1 , 2% , 3% / .4 )", "rgb(url(x))", "rgb(1;2)", "var(--x)", "rgb()", "", "   ",
  "javascript:alert(1)", "#fff;", "x".repeat(121), 5, null, true,
];

const FONTS: unknown[] = [
  "Inter", "Inter, sans-serif", "'Fira Code', monospace", '"IBM Plex Sans", system-ui',
  "a,b,c,d,e", "a,b,c,d,e,f", "Inter,,serif", "Bad;Font", "Ünicode", "-dash", "SERIF",
  " UI-Monospace ", "x".repeat(41), "Name With  Spaces", "", 3, null, "url(x)",
];

const LENGTHS: unknown[] = [
  0, 4, 12.5, 64, 65, -1, 0.25, 1.005, "8px", "0", "0rem", "0.5rem", "4rem", "4.01rem",
  "1.25em", " 12 ", "12.345px", "1000", "64px", "65px", "12pt", "-2px", "", "px",
  "1e2", null, true, "12px;",
];

const NAMES: unknown[] = [
  "Calm", "  Spaced  ", "Ctrl\u0001chars\u007f", "é".repeat(70), "x".repeat(61), "", 7, null,
];

const ALL_VALUES = [...COLORS, ...FONTS, ...LENGTHS, ...NAMES];

function section(
  rand: () => number,
  keys: readonly string[],
  values: readonly unknown[],
): unknown {
  if (rand() < 0.08) return pick(rand, JUNK);
  const out: Record<string, unknown> = {};
  const count = Math.floor(rand() * 6);
  for (let i = 0; i < count; i++) {
    const key = rand() < 0.9 ? pick(rand, keys) : pick(rand, ["nope", "10", "2", "BG", ""]);
    out[key] = rand() < 0.85 ? pick(rand, values) : pick(rand, ALL_VALUES);
  }
  return out;
}

function themeObject(rand: () => number): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (rand() < 0.9) o.version = rand() < 0.9 ? 1 : pick(rand, [2, "1", null, 0]);
  if (rand() < 0.7) o.name = pick(rand, NAMES);
  if (rand() < 0.6) o.mode = pick(rand, ["light", "dark", "Dark", "auto", "", 1]);
  if (rand() < 0.5) o.surfaces = pick(rand, ["borderless", "bordered", "flat", null]);
  if (rand() < 0.5) {
    o.motion = rand() < 0.1
      ? pick(rand, JUNK)
      : {
          ...(rand() < 0.7 ? { reactive: pick(rand, [true, false, "yes", 1]) } : {}),
          ...(rand() < 0.7 ? { scale: pick(rand, [0, 0.5, 1, 1.234, 2, 2.5, -1, "1"]) } : {}),
          ...(rand() < 0.1 ? { extra: 1 } : {}),
        };
  }
  if (rand() < 0.3) o.tilt = pick(rand, [true, false, "on", null]);
  if (rand() < 0.8) o.colors = section(rand, ts.THEME_COLOR_KEYS, COLORS);
  if (rand() < 0.6) o.fonts = section(rand, ts.THEME_FONT_KEYS, FONTS);
  if (rand() < 0.6) o.radius = section(rand, ts.THEME_RADIUS_KEYS, LENGTHS);
  if (rand() < 0.1) o[pick(rand, ["extra", "Colors", "10", "1"])] = 1;
  return o;
}

/** Splices a poison key into JSON text, since an object literal cannot hold `__proto__`. */
function poison(rand: () => number, text: string): string {
  const key = pick(rand, ["__proto__", "constructor", "prototype"]);
  const at = text.indexOf("{", rand() < 0.5 ? 0 : 1);
  if (at < 0) return text;
  const body = text.slice(at + 1);
  const sep = body.startsWith("}") ? "" : ",";
  return `${text.slice(0, at + 1)}"${key}":{"a":1}${sep}${body}`;
}

test("parseThemeConfig matches TS on generated files", () => {
  for (let seed = 1; seed <= 600; seed++) {
    const rand = random(seed);
    let text = JSON.stringify(themeObject(rand), null, rand() < 0.5 ? 2 : undefined);
    if (rand() < 0.08) text = poison(rand, text);
    if (rand() < 0.05) text = text.slice(0, Math.floor(rand() * text.length));
    assert.deepEqual(rs.parseThemeConfig(text), ts.parseThemeConfig(text), `seed ${seed}: ${text}`);
  }
});

test("parseThemeConfig matches TS on edge files", () => {
  const big = JSON.stringify({ version: 1, name: "x".repeat(ts.THEME_CONFIG_MAX_BYTES) });
  const many = JSON.stringify({
    version: 1,
    colors: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, "#fff"])),
  });
  const manyErrors = JSON.stringify({
    version: 1,
    colors: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, "#fff"])),
  });
  const cases = [
    "", "   ", "null", "[]", "1", '"x"', "{", "{}", '{"version":1}', '{"version":"1"}',
    '{"version":1,"zz":1,"10":2,"2":3,"b":4}', big, many, manyErrors,
    '{"version":1,"colors":{"bg":"#fff","bg":"#000"}}',
    '{"version":1,"colors":{"a":{"b":{"c":{"d":{"e":{"f":{"__proto__":1}}}}}}}}',
    '{"version":1,"colors":{"a":{"b":{"c":{"d":{"e":{"__proto__":1}}}}}}}',
    '{"version":1,"colors":[{"__proto__":1}]}',
    '{"version":1,"name":"\\u00e9t\\u00e9"}',
    '﻿{"version":1}',
  ];
  for (const text of cases) {
    assert.deepEqual(rs.parseThemeConfig(text), ts.parseThemeConfig(text), text.slice(0, 120));
  }
});

test("value normalizers match TS", () => {
  for (const raw of [...ALL_VALUES, undefined, {}, [], Number.NaN]) {
    assert.equal(rs.normalizeColorValue(raw), ts.normalizeColorValue(raw), `color ${String(raw)}`);
    assert.equal(rs.normalizeFontStack(raw), ts.normalizeFontStack(raw), `font ${String(raw)}`);
    for (const max of [undefined, 16, 64, 100]) {
      assert.equal(
        rs.normalizeLengthValue(raw, max),
        ts.normalizeLengthValue(raw, max),
        `length ${String(raw)} max ${String(max)}`,
      );
    }
  }
});

test("normalizeThemeConfig matches TS", () => {
  for (const raw of [...JUNK, undefined]) {
    assert.deepEqual(rs.normalizeThemeConfig(raw), ts.normalizeThemeConfig(raw), String(raw));
  }
  for (let seed = 1; seed <= 300; seed++) {
    const rand = random(seed);
    const parsed = ts.parseThemeConfig(JSON.stringify(themeObject(rand))).config;
    const stored: unknown = parsed && rand() < 0.3
      ? { ...parsed, vars: { ...parsed.vars, [pick(rand, ["--x", "--color-bg", "--radius-card"])]: pick(rand, ALL_VALUES) } }
      : parsed;
    assert.deepEqual(rs.normalizeThemeConfig(stored), ts.normalizeThemeConfig(stored), `seed ${seed}`);
  }
});

test("themeConfigTemplate matches TS", () => {
  assert.equal(rs.themeConfigTemplate(), ts.themeConfigTemplate());
});
