#!/usr/bin/env node
/**
 * WCAG 2.1 contrast audit for every theme in src/app/themes/.
 *
 * Parses each theme selector block, resolves the colour tokens it defines
 * (hex, rgb(), oklch() and var() aliases), and checks the key text/surface
 * pairs the UI actually renders — body, muted and faint copy, the accent
 * button, the semantic status ramp both on its own tint (the pills) and
 * straight on the page (chips, icon tints, the status bar), and the confetti
 * card tints. Themes that omit a token inherit it from `:root` (Paper and the
 * alias layer), matching how the cascade behaves at runtime.
 *
 * A pair the script cannot read (a color-mix(), a see-through colour, a token
 * nobody defines) fails: a skipped pair is an unmeasured one (design D20, G7).
 *
 * Usage:  node scripts/contrast-audit.mjs [themes-dir]
 * Exit code 1 if any pair falls below its bar or cannot be read.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ?? join(here, "../src/app/themes");
// Every palette file at once: the audit compares tokens within one theme, and
// a theme is one file, so concatenating them keeps each block intact.
const css = readdirSync(dir)
  .filter((f) => f.endsWith(".css") && f !== "index.css")
  .map((f) => readFileSync(join(dir, f), "utf8"))
  .join("\n");

// --- color math ---------------------------------------------------------
/** sRGB 0–255 from a hex colour; null when it is see-through or malformed. */
function hexToRgb(hex) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) {
    if (h.slice(6).toLowerCase() !== "ff") return null;
    h = h.slice(0, 6);
  }
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** A number, or a percentage of `full`. */
function num(s, full) {
  const v = parseFloat(s);
  if (Number.isNaN(v)) return NaN;
  return s.trim().endsWith("%") ? (v / 100) * full : v;
}
/** The three channels inside `fn(...)`; null when see-through or not that function. */
function channels(value, fn) {
  const m = value.match(new RegExp(`^${fn}\\((.*)\\)$`, "i"));
  if (!m) return null;
  const [main, alpha] = m[1].split("/");
  const parts = main.split(/[\s,]+/).filter(Boolean);
  const a = alpha ?? (parts.length === 4 ? parts.pop() : undefined);
  if (a !== undefined && num(a, 1) !== 1) return null;
  return parts.length === 3 ? parts : null;
}
function rgbFn(value) {
  const p = channels(value, "rgba?");
  if (!p) return null;
  const c = p.map((x) => num(x, 255));
  return c.some(Number.isNaN) ? null : c;
}
/** oklch → sRGB 0–255, through OKLab and linear sRGB, clipped to the gamut. */
function oklchFn(value) {
  const p = channels(value, "oklch");
  if (!p) return null;
  const [L, C, H] = [num(p[0], 1), num(p[1], 0.4), parseFloat(p[2])];
  if ([L, C, H].some(Number.isNaN)) return null;
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => {
    const c = Math.min(1, Math.max(0, v));
    return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  });
}
function relLum([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fg, bg) {
  const a = relLum(fg), b = relLum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// --- parse theme blocks -------------------------------------------------
/** Every custom property in a `{ ... }` body, value as written. */
function parseTokens(body) {
  const out = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body))) out[m[1]] = m[2].trim();
  return out;
}

/**
 * Tokens per selector, merged in source order. A block written for several
 * selectors (`:root, [data-theme="light"]`) gives its tokens to each.
 */
function parseThemes(src) {
  const bySelector = new Map();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const text = src.replace(/\/\*[\s\S]*?\*\//g, "");
  let m;
  while ((m = re.exec(text))) {
    const tokens = parseTokens(m[2]);
    for (const sel of m[1].split(",").map((x) => x.trim())) {
      const attr = sel.match(/^(?::root)?\[data-theme="([^"]+)"\]$/);
      const name = sel === ":root" ? ":root" : attr?.[1];
      if (!name) continue;
      bySelector.set(name, { ...bySelector.get(name), ...tokens });
    }
  }
  return bySelector;
}

const themes = parseThemes(css);
const root = themes.get(":root") ?? {};

/**
 * The semantic status ramp, which `themes/common.css` aliases onto the pill
 * families (`--st-positive-fg: var(--s-good)`, and so on).
 *
 * Checked as *text*, at 4.5:1, because that is what it is: `entity-detail.css`
 * renders `.status-*` pills as `color: var(--st-*-fg)` on `var(--st-*-bg)` at
 * `font-size: 0.72rem`, and the same ramp is the text colour of the git chip
 * (`git.css`), the explorer's dirty/untracked marks and the status bar's save
 * state (`editor-workspace.css`). It was not in this list until a design audit
 * asked what the script left unmeasured; eleven of the fourteen themes were
 * below AA on it, three of them below 2:1.
 */
const RAMP = ["neutral", "info", "good", "warn", "danger", "mute"];

// Pairs the UI renders: [foreground token, background token, label, largeText?]
const PAIRS = [
  ["--text", "--bg", "body text on bg"],
  ["--muted", "--bg", "muted text on bg"],
  ["--muted", "--surface2", "muted on row/chip"],
  /* `--faint` at the 3:1 large-text bar, which is the bar this script has
     always applied and the one every theme now clears. It is the honest bar
     for the decorative uses — the pitch's SVG card notes, a dimmed macro — and
     it is *not* the honest bar for the small text that also wears it
     (`.rowNote` at 0.78rem, an input placeholder), where WCAG wants 4.5:1.
     Raising the token to 4.5:1 would put it within a step of `--muted` in
     nine themes and collapse the hierarchy the ramp exists to express, so
     that is a design decision rather than a contrast fix, and it is recorded
     as open in docs/internal/reports/redesign-audit-fixes.md instead of being
     silently settled here. */
  ["--faint", "--bg", "faint text on bg", true], // decorative → 3:1 bar
  ["--accent-fg", "--accent", "button label on accent"],
  // Text that wants the accent reads `--accent-ink`, which common.css points
  // at `--accent` and a theme with a fill-only accent (brutal's yellow) sets
  // to something legible; the var() alias resolves inside each theme.
  ["--accent-ink", "--bg", "accent-as-text on bg"],
  // Status pills: the ramp on its own tint.
  ...RAMP.map((k) => [`--s-${k}`, `--s-${k}-bg`, `status ${k} on tint`]),
  // The same ramp as text straight on the page: chips, icon tints, status bar.
  ...RAMP.map((k) => [`--s-${k}`, "--bg", `status ${k} on bg`]),
];

/** Card tints a theme paints (styles/cards.css), and the copy that sits on them. */
const tintPairs = (lookup) =>
  [1, 2, 3, 4, 5, 6]
    .filter((k) => lookup(`--confetti-${k}-bg`) !== undefined)
    .flatMap((k) => [
      ["--text", `--confetti-${k}-bg`, `text on card tint ${k}`],
      ["--muted", `--confetti-${k}-bg`, `muted on card tint ${k}`],
    ]);

let failures = 0;

for (const [name, own] of themes) {
  if (name === ":root" || own["--bg"] === undefined) continue; // alias-only blocks
  const lookup = (token) => own[token] ?? root[token];
  /** A token's colour, following var() inside this theme; a reason when it cannot. */
  const colour = (token, depth = 0) => {
    const value = lookup(token);
    if (value === undefined) return `${token} is not defined`;
    const alias = value.match(/^var\((--[\w-]+)\)$/);
    if (alias && depth < 8) return colour(alias[1], depth + 1);
    const rgb = value.startsWith("#") ? hexToRgb(value) : (rgbFn(value) ?? oklchFn(value));
    return rgb ?? `cannot read ${token}: ${value}`;
  };
  const rows = [];
  for (const [fgN, bgN, label, large] of [...PAIRS, ...tintPairs(lookup)]) {
    const fg = colour(fgN), bg = colour(bgN);
    const bar = large ? 3 : 4.5;
    if (typeof fg === "string" || typeof bg === "string") {
      failures++;
      rows.push([label, "n/a", `FAIL (${typeof fg === "string" ? fg : bg})`]);
      continue;
    }
    const r = ratio(fg, bg);
    const pass = r >= bar;
    if (!pass) failures++;
    rows.push([label, r.toFixed(2), pass ? "ok" : `FAIL (< ${bar})`]);
  }
  console.log(`\n${name}`);
  for (const [label, r, verdict] of rows) {
    console.log(`  ${verdict === "ok" ? " " : "✗"} ${label.padEnd(24)} ${String(r).padStart(6)}  ${verdict}`);
  }
}

console.log(`\n${failures} pair(s) below their bar or unreadable.`);
process.exit(failures > 0 ? 1 : 0);
