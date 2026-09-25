#!/usr/bin/env node
/**
 * WCAG 2.1 contrast audit for every theme in src/app/themes/.
 *
 * Parses each theme selector block, resolves the raw color tokens it defines
 * (hex only — color-mix()/var() aliases are skipped), and checks the key
 * text/surface pairs the UI actually renders — body, muted and faint copy, the
 * accent button, and the semantic status ramp both on its own tint (the pills)
 * and straight on the page (chips, icon tints, the status bar). Themes that
 * omit a raw token inherit it from the default light `:root` (Paper) base,
 * matching how the cascade behaves at runtime.
 *
 * Usage:  node scripts/contrast-audit.mjs
 * Exit code 1 if any normal-text pair falls below AA (4.5:1).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../src/app/themes");
// Every palette file at once: the audit compares tokens within one theme, and
// a theme is one file, so concatenating them keeps each block intact while
// letting the parser below stay exactly as it was when this was one file.
const css = readdirSync(dir)
  .filter((f) => f.endsWith(".css") && f !== "index.css")
  .map((f) => readFileSync(join(dir, f), "utf8"))
  .join("\n");

// --- color math ---------------------------------------------------------
function hexToRgb(hex) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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
/** Extract hex-valued custom props from a `{ ... }` body. */
function parseTokens(body) {
  const out = {};
  const re = /(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g;
  let m;
  while ((m = re.exec(body))) out[m[1]] = m[2];
  return out;
}

/** Split the file into { name, tokens } blocks in source order. */
function parseThemes(src) {
  const blocks = [];
  const re = /(:root(?:\[data-theme="[^"]+"\])?|\[data-theme="[^"]+"\])\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const start = re.lastIndex;
    // find matching close brace (bodies here have no nested braces)
    const end = src.indexOf("}", start);
    const body = src.slice(start, end);
    const attr = m[1].match(/data-theme="([^"]+)"/);
    blocks.push({ name: attr ? attr[1] : "paper (:root)", tokens: parseTokens(body) });
  }
  return blocks;
}

const blocks = parseThemes(css);
// The very first :root is the alias layer (no raw hex); Paper base is the
// first block that actually defines --bg.
const base = blocks.find((b) => b.tokens["--bg"])?.tokens ?? {};

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
  // to something legible; the audit follows the same fallback.
  ["--accent-ink", "--bg", "accent-as-text on bg"],
  // Status pills: the ramp on its own tint.
  ...RAMP.map((k) => [`--s-${k}`, `--s-${k}-bg`, `status ${k} on tint`]),
  // The same ramp as text straight on the page: chips, icon tints, status bar.
  ...RAMP.map((k) => [`--s-${k}`, "--bg", `status ${k} on bg`]),
];

let failures = 0;
const themeBlocks = blocks.filter((b) => b.tokens["--bg"]); // skip alias-only :root

for (const t of themeBlocks) {
  const raw = (name) => t.tokens[name] ?? base[name];
  const tok = (name) => (name === "--accent-ink" && !hexToRgb(raw(name) ?? "") ? raw("--accent") : raw(name));
  const rows = [];
  for (const [fgN, bgN, label, large] of PAIRS) {
    const fg = hexToRgb(tok(fgN) ?? ""), bg = hexToRgb(tok(bgN) ?? "");
    if (!fg || !bg) { rows.push([label, "n/a", "skip (non-hex)"]); continue; }
    const r = ratio(fg, bg);
    const bar = large ? 3 : 4.5;
    const pass = r >= bar;
    if (!pass && !large) failures++;
    rows.push([label, r.toFixed(2), pass ? "ok" : `FAIL (< ${bar})`]);
  }
  console.log(`\n${t.name}`);
  for (const [label, r, verdict] of rows) {
    const mark = verdict === "ok" ? " " : verdict.startsWith("FAIL") ? "✗" : "·";
    console.log(`  ${mark} ${label.padEnd(24)} ${String(r).padStart(6)}  ${verdict}`);
  }
}

console.log(`\n${failures} normal-text pair(s) below AA (4.5:1).`);
process.exit(failures > 0 ? 1 : 0);
