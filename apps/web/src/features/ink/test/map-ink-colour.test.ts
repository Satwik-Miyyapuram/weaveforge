/**
 * Theme-relative ink colours (0.9.5). A stored stroke hex is canonical: the
 * colour as it looks on the light Paper theme. At render it is mapped to the
 * current theme in OKLCH (lightness relative to page and text, chroma scaled by
 * the theme's accents, hue kept); a colour picked in a theme is mapped back
 * before it is saved.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import fc from "fast-check";
import { clampChroma, differenceEuclidean, formatHex, oklch } from "culori";

import { mapInkColour, PAPER_INK_SLOTS, PAPER_INK_THEME, type InkTheme } from "../render/map-ink-colour";

const deltaE = differenceEuclidean("oklab");

const DARK: InkTheme = {
  bg: "#14171c",
  fg: "#e7ebf1",
  accents: ["#7aa2e3", "#7cc4de", "#7fc79a", "#d6a860", "#e08a80"],
};
const CRT: InkTheme = {
  bg: "#e7cfa6",
  fg: "#2b222b",
  accents: ["#1f6dab", "#2b222b", "#2b222b", "#2b222b", "#8f1f14"],
};
const GREEN_ON_BLACK: InkTheme = { bg: "#000000", fg: "#33ff66", accents: ["#33ff66", "#00cc44"] };
const THEMES = [PAPER_INK_THEME, DARK, CRT, GREEN_ON_BLACK];
const theme = fc.constantFrom(...THEMES);

const hex = fc
  .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
  .map(([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);

const L = (c: string) => oklch(c)!.l;
/** Position between paper (0) and ink (1) on a theme. */
const t = (c: string, th: InkTheme) => (L(c) - L(th.bg)) / (L(th.fg) - L(th.bg));
const hueGap = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/**
 * True when mapping `c` onto `to` needs no clamp: lightness in range and the
 * colour in gamut. Below L 0.15 one 8-bit sRGB step is itself near a JND in
 * OKLab (L of #010101 is 0.07), so a hex cannot round-trip finer there.
 */
function unclamped(c: string, to: InkTheme): boolean {
  const tt = t(c, PAPER_INK_THEME);
  const l = L(to.bg) + tt * (L(to.fg) - L(to.bg));
  if (L(c) < 0.15 || l < 0.15 || l > 0.98) return false;
  const o = oklch(c)!;
  const k = chromaScale(to);
  const want = { mode: "oklch" as const, l, c: (o.c ?? 0) * k, h: o.h };
  return Math.abs((clampChroma(want, "oklch").c ?? 0) - want.c) < 1e-4;
}
/** In gamut with room to spare: rounding on the way back cannot push it past the sRGB edge. */
function insideGamut(c: string): boolean {
  const o = oklch(c)!;
  const want = { ...o, c: (o.c ?? 0) * 1.1 };
  return Math.abs((clampChroma(want, "oklch").c ?? 0) - want.c) < 1e-4;
}
function chromaScale(to: InkTheme): number {
  const mean = (th: InkTheme) => th.accents.reduce((s, a) => s + (oklch(a)!.c ?? 0), 0) / th.accents.length;
  const k = mean(to) / mean(PAPER_INK_THEME);
  return L(to.bg) < 0.5 ? Math.min(k, 1) : k;
}

test("the Paper theme's tokens are the ones light.css and the marker block define", () => {
  const light = readFileSync(new URL("../../../app/themes/light.css", import.meta.url), "utf8");
  for (const [token, value] of [
    ["--bg", PAPER_INK_THEME.bg],
    ["--text", PAPER_INK_SLOTS.text],
    ["--accent", PAPER_INK_SLOTS.accent],
    ["--s-info", PAPER_INK_SLOTS.info],
    ["--s-good", PAPER_INK_SLOTS.good],
    ["--s-warn", PAPER_INK_SLOTS.warn],
    ["--s-danger", PAPER_INK_SLOTS.danger],
  ]) {
    assert.match(light, new RegExp(`${token}:\\s*${value}`, "i"), `${token} is ${value}`);
  }
});

test("the marker slots are the fixed hex editor-workspace.css gives every theme", () => {
  const css = readFileSync(new URL("../../../app/styles/editor-workspace.css", import.meta.url), "utf8");
  for (const name of ["yellow", "red", "green", "blue", "purple", "pink", "orange", "grey"] as const) {
    assert.match(css, new RegExp(`--ink-${name}:\\s*${PAPER_INK_SLOTS[name]}`, "i"), name);
  }
});

test("identity on the Paper theme", () => {
  fc.assert(fc.property(hex, (c) => assert.equal(mapInkColour(c, PAPER_INK_THEME, PAPER_INK_THEME), c)));
});

test("near-black ink on Paper becomes light ink on Dark, and red stays a red", () => {
  assert.ok(L(mapInkColour("#1f2328", PAPER_INK_THEME, DARK)) > 0.85);
  const red = oklch(mapInkColour("#d03030", PAPER_INK_THEME, DARK))!;
  assert.ok(hueGap(red.h!, oklch("#d03030")!.h!) <= 3 && (red.c ?? 0) > 0.1);
});

test("the output is always a valid sRGB hex, and the same every time", () => {
  fc.assert(
    fc.property(hex, theme, theme, (c, from, to) => {
      const out = mapInkColour(c, from, to);
      assert.match(out, /^#[0-9a-f]{6}$/);
      assert.equal(mapInkColour(c, from, to), out);
    }),
    { numRuns: 3000 },
  );
});

test("inverse(map(c)) is within a JND of c for in-gamut colours the map need not clamp", () => {
  fc.assert(
    fc.property(hex, theme, (c, to) => {
      fc.pre(unclamped(c, to) && insideGamut(c));
      const back = mapInkColour(mapInkColour(c, PAPER_INK_THEME, to), to, PAPER_INK_THEME);
      assert.ok(deltaE(back, c) <= 0.02, `${c} -> ${back}: dE ${deltaE(back, c).toFixed(4)}`);
    }),
    { numRuns: 3000 },
  );
});

test("hue drifts at most 3 degrees where chroma is above 0.02", () => {
  fc.assert(
    fc.property(hex, theme, (c, to) => {
      const before = oklch(c)!;
      fc.pre((before.c ?? 0) > 0.02);
      const after = oklch(mapInkColour(c, PAPER_INK_THEME, to))!;
      fc.pre((after.c ?? 0) > 0.02);
      const d = hueGap(after.h!, before.h!);
      assert.ok(d <= 3, `${c} on ${to.bg}: hue moved ${d.toFixed(2)} deg`);
    }),
    { numRuns: 3000 },
  );
});

test("order is kept: closer to the paper on Paper stays closer to the paper on the theme", () => {
  fc.assert(
    fc.property(hex, hex, theme, (a, b, to) => {
      fc.pre(t(a, PAPER_INK_THEME) + 0.02 < t(b, PAPER_INK_THEME));
      const ta = t(mapInkColour(a, PAPER_INK_THEME, to), to);
      const tb = t(mapInkColour(b, PAPER_INK_THEME, to), to);
      assert.ok(ta <= tb + 0.01, `${a} ${b} on ${to.bg}: ${ta.toFixed(3)} vs ${tb.toFixed(3)}`);
    }),
    { numRuns: 3000 },
  );
});

test("two distinct inks stay distinguishable (dE_ok >= 0.02) after mapping (Chameleon-style)", () => {
  fc.assert(
    fc.property(hex, hex, theme, (a, b, to) => {
      fc.pre(deltaE(a, b) >= 0.04 && unclamped(a, to) && unclamped(b, to));
      const d = deltaE(mapInkColour(a, PAPER_INK_THEME, to), mapInkColour(b, PAPER_INK_THEME, to));
      assert.ok(d >= 0.02, `${a} ${b} on ${to.bg}: dE ${d.toFixed(4)}`);
    }),
    { numRuns: 3000 },
  );
});

test("a dark theme never boosts chroma (Helmholtz-Kohlrausch cap)", () => {
  const vivid: InkTheme = { ...DARK, accents: ["#ff0000", "#00ff00", "#0000ff"] };
  const c = "#8a5a5a";
  assert.ok((oklch(mapInkColour(c, PAPER_INK_THEME, vivid))!.c ?? 0) <= (oklch(c)!.c ?? 0) + 0.005);
});

test("formatHex sanity: culori is the colour library in use", () => {
  assert.equal(formatHex("#FF0000"), "#ff0000");
});
