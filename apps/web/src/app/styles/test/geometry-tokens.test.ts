/**
 * Radius, shadow and spacing read through one name per role (design D07,
 * R1.1, R4.1). Corners are four values per theme, so a card, a control, a
 * tag and a pill each look the same wherever they appear.
 *
 * Colour literals and off-scale spacing are too common to remove in one step;
 * their tests are ratchets: they fail only when the count rises. Lower the
 * ceiling as rules move over; never raise it.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const styles = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Poster's own stylesheet is a theme: it may restate geometry in its own voice. */
const THEME_FILES = new Set(["brutal.css"]);
const sheets = readdirSync(styles).filter((f) => f.endsWith(".css") && !THEME_FILES.has(f));
const read = (f: string) => readFileSync(path.join(styles, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** A hairline, a circle, none or the parent's: not a role. */
const RADIUS_EXEMPT = /^(0|0px|1px|2px|50%|100%|inherit)$/;

/** Literal radii that are not a role token: `border-radius: 8px` → ["8px"]. */
export function literalRadii(css: string): string[] {
  const hits: string[] = [];
  for (const m of css.matchAll(/border(?:-[a-z]+)*-radius:\s*([^;}]+)/g)) {
    const value = (m[1] ?? "").replace(/!important/, "").trim();
    // A var() read, a calc over tokens or a max() is a token read: skip it.
    if (/\(/.test(value)) continue;
    for (const part of value.split(/\s+/)) if (!RADIUS_EXEMPT.test(part)) hits.push(part);
  }
  return hits;
}

const SCALE = new Set([0, 1, 2, 4, 8, 12, 16, 24, 32, 48]);

/** Pixel values in padding, margin or gap that are off the R4.1 scale. */
export function offScaleSpacing(css: string): string[] {
  const hits: string[] = [];
  for (const m of css.matchAll(/(?:^|[\s;{])(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?:\s*([^;}]+)/g)) {
    for (const px of (m[1] ?? "").matchAll(/(?<![\w.-])(\d*\.?\d+)px\b/g)) {
      if (!SCALE.has(Number(px[1]))) hits.push(`${px[1]}px`);
    }
  }
  return hits;
}

/** Hex, rgb() and hsl() colours written in a feature stylesheet (R1.3). */
export function colourLiterals(css: string): string[] {
  return [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g)].map((m) => m[0]);
}

test("the radius scanner flags a literal and passes a token, a hairline and a circle", () => {
  assert.deepEqual(literalRadii(".a { border-radius: 8px; } .b { border-top-left-radius: 14px 14px; }"), ["8px", "14px", "14px"]);
  assert.deepEqual(
    literalRadii(".a { border-radius: var(--r-card); } .b { border-radius: 50%; } .c { border-radius: 2px; } .d { border-radius: max(2px, calc(var(--wf-rc) - 2px)); }"),
    [],
  );
});

test("the spacing scanner flags off-scale pixels and passes the scale and tokens", () => {
  assert.deepEqual(offScaleSpacing(".a { padding: 10px 16px; margin-top: 6px; gap: var(--s2); }"), ["10px", "6px"]);
  assert.deepEqual(offScaleSpacing(".a { padding: 8px 12px; margin: 0 auto; gap: 1px; } .b { --gap: 10px; }"), []);
});

test("the colour scanner finds hex, rgb and hsl but not a token or an id", () => {
  assert.deepEqual(colourLiterals(".a { color: #fff; background: rgba(0,0,0,.4); border-color: hsl(0 0% 0%); }"), ["#fff", "rgba(", "hsl("]);
  assert.deepEqual(colourLiterals(".a { color: var(--text); } #main { color: currentColor; }"), []);
});

test("the role tokens for radius, shadow and space are defined on :root", () => {
  const base = read("base.css");
  for (const role of ["--r-sm", "--r-control", "--r-card", "--r-pill", "--sh-rest", "--sh-raised", "--sh-overlay"]) {
    assert.match(base, new RegExp(`${role}:`), role);
  }
  const scale = [4, 8, 12, 16, 24, 32, 48];
  scale.forEach((px, i) => assert.match(base, new RegExp(`--s${i + 1}: ${px}px;`), `--s${i + 1}`));
});

test("every corner outside a theme file is a radius role (at most four values per theme)", () => {
  const found = sheets.flatMap((f) => literalRadii(read(f)).map((v) => `${f}: ${v}`));
  assert.deepEqual(found, []);
});

/** Ratchets (G2, G4). Counts as of D07; lower them as rules move over. */
const COLOUR_CEILING = 120;
const SPACING_CEILING = 825;

test("colour literals in feature stylesheets do not grow (G2)", () => {
  const count = sheets.reduce((n, f) => n + colourLiterals(read(f)).length, 0);
  assert.ok(count <= COLOUR_CEILING, `${count} colour literals, ceiling ${COLOUR_CEILING}; use a theme token`);
});

test("off-scale spacing in feature stylesheets does not grow (G4)", () => {
  const count = sheets.reduce((n, f) => n + offScaleSpacing(read(f)).length, 0);
  assert.ok(count <= SPACING_CEILING, `${count} off-scale px, ceiling ${SPACING_CEILING}; use --s1..--s7`);
});

/**
 * A two-column page (rail + panels) spaces its cards with grid gap. A card's
 * own `.add-form` margin on top of that pushed the first panel 16px below the
 * rail, so the two columns started at different heights (DA-52).
 */
test("panel columns beside a rail start level with it (DA-52)", () => {
  for (const [file, column] of [["privacy.css", ".settings-body"], ["org-chart.css", ".superv-panels"]] as const) {
    const css = read(file);
    assert.ok(css.includes(`${column} > * { margin: 0; }`), `${file}: ${column} children keep a margin`);
  }
});
