#!/usr/bin/env node
/**
 * WCAG 2.1 contrast audit for every theme in src/app/themes/.
 *
 * Parses each theme selector block, resolves the raw color tokens it defines
 * (hex only — color-mix()/var() aliases are skipped), and checks the key
 * text/surface pairs the UI actually renders. Themes that omit a raw token
 * inherit it from the default light `:root` (Paper) base, matching how the
 * cascade behaves at runtime.
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

// Pairs the UI renders: [foreground token, background token, label, largeText?]
const PAIRS = [
  ["--text", "--bg", "body text on bg"],
  ["--muted", "--bg", "muted text on bg"],
  ["--muted", "--surface2", "muted on row/chip"],
  ["--faint", "--bg", "faint text on bg", true], // decorative → 3:1 bar
  ["--accent-fg", "--accent", "button label on accent"],
  ["--accent", "--bg", "accent-as-text on bg"],
];

let failures = 0;
const themeBlocks = blocks.filter((b) => b.tokens["--bg"]); // skip alias-only :root

for (const t of themeBlocks) {
  const tok = (name) => t.tokens[name] ?? base[name];
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
