/**
 * Every text uses one of a few type roles (design D06, DA-37..39). Sixty
 * hand-picked sizes between 0.6rem and 1.65rem read as sixty slightly
 * different texts; the roles are tokens on :root so a theme or the browser's
 * own text size scales all of them at once.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const styles = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Poster's own stylesheet is a theme: it may restate sizes in its own voice. */
const THEME_FILES = new Set(["brutal.css"]);
const sheets = readdirSync(styles).filter((f) => f.endsWith(".css") && !THEME_FILES.has(f));
const read = (f: string) => readFileSync(path.join(styles, f), "utf8");

/** Display sizes (stat numbers, hero titles, glyphs) start here: 28px. */
const DISPLAY_MIN_PX = 28;

function px(value: string): number | null {
  const m = /^(\d*\.?\d+)(rem|px)$/.exec(value.trim());
  if (!m) return null;
  return m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
}

/** A font-size that is a raw literal below display size, i.e. not a role. */
export function offRoleSizes(css: string): string[] {
  const hits: string[] = [];
  for (const m of css.matchAll(/font-size:\s*([^;}!]+)/g)) {
    const value = (m[1] ?? "").trim();
    const size = px(value);
    if (size !== null && size < DISPLAY_MIN_PX) hits.push(value);
  }
  // The `font:` shorthand carries a size too: `font: 600 13px var(--font)`.
  for (const m of css.matchAll(/(?:^|[\s;{])font:\s*(?:[\w-]+\s+)*?(\d*\.?\d+(?:rem|px))(?=[\s/])/g)) {
    const size = px(m[1] ?? "");
    if (size !== null && size < DISPLAY_MIN_PX) hits.push(m[1] ?? "");
  }
  return hits;
}

test("the scanner flags a literal and passes a role, an em and a display size", () => {
  assert.deepEqual(offRoleSizes(".a { font-size: 0.78rem; } .b { font-size: 13px; }"), ["0.78rem", "13px"]);
  assert.deepEqual(offRoleSizes(".a { font: 600 13px var(--font); } .b { font: .78rem/1.5 var(--font-mono); }"), ["13px", ".78rem"]);
  assert.deepEqual(offRoleSizes(".a { font: 600 var(--fs-sm) var(--font); } .b { --wf-font: var(--x); }"), []);
  assert.deepEqual(
    offRoleSizes(".a { font-size: var(--fs-sm); } .b { font-size: 0.9em; } .c { font-size: 2rem; } .d { font-size: inherit; }"),
    [],
  );
});

test("every font-size below display size is a type role", () => {
  const found = sheets.flatMap((f) => offRoleSizes(read(f)).map((v) => `${f}: ${v}`));
  assert.deepEqual(found, []);
});

test("the roles are defined once, in rem, on :root", () => {
  const base = read("base.css");
  for (const role of ["--fs-micro", "--fs-xs", "--fs-sm", "--fs", "--fs-lg", "--fs-h2", "--fs-h1"]) {
    assert.match(base, new RegExp(`${role}:\\s*\\d*\\.?\\d+rem;`), role);
  }
});

/** Tags, chips, labels and card meta are words, not code: they use the sans face (D-02). */
export function monoChips(css: string): string[] {
  const chip = /\.(tag-chip|chip|plan-chip|wf-chip|git-chip|metric-chip|jump-to-chip|graph-chip|tint-sample-chip|auth-art-chip|entity-card-meta)\b/;
  const hits: string[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (chip.test(m[1] ?? "") && /font(-family)?:[^;]*--font-mono/.test(m[2] ?? "")) hits.push((m[1] ?? "").trim());
  }
  return hits;
}

test("the chip scanner flags a mono chip and passes a sans one", () => {
  assert.deepEqual(monoChips(".tag-chip { font-family: var(--font-mono); }"), [".tag-chip"]);
  assert.deepEqual(monoChips(".log-item .entity-card-meta { font: 600 var(--fs-xs) var(--font-mono); }"), [".log-item .entity-card-meta"]);
  assert.deepEqual(monoChips(".tag-chip { font-family: var(--font); } .commit-sha { font-family: var(--font-mono); }"), []);
});

test("no chip or tag is set in the mono face, in any theme", () => {
  const all = readdirSync(styles).filter((f) => f.endsWith(".css"));
  const found = all.flatMap((f) => monoChips(read(f)).map((s) => `${f}: ${s}`));
  assert.deepEqual(found, []);
});
