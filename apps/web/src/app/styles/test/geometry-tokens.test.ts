/**
 * Radius, shadow and spacing read through one name per role (design D07,
 * R1.1, R4.1). Corners are four values per theme, so a card, a control, a
 * tag and a pill each look the same wherever they appear.
 *
 * Colour is a theme's job (G2): outside a theme file a colour literal may only
 * define a custom property. Spacing steps on one scale (G4). Both hold at zero
 * across every stylesheet in the app, the pitch page included.
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

/** Every stylesheet outside app/themes, as a path from app/ (G2, G4 scope). */
const app = path.join(styles, "..");
const allSheets = ["", "styles", "pitch"].flatMap((dir) =>
  readdirSync(path.join(app, dir))
    .filter((f) => f.endsWith(".css"))
    .map((f) => (dir ? `${dir}/${f}` : f)),
);
const readApp = (f: string) => readFileSync(path.join(app, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Built from the design-system bundle; fix it there and regenerate. */
const GENERATED = new Set(["styles/states.css"]);
/** Palettes: the app's poster theme and the pitch page's looks. */
const PALETTES = new Set(["styles/brutal.css", "pitch/looks.css"]);

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
/** Past --s7, whole steps of 16px (a page's bottom room, a hero's inset). */
const onScale = (px: number) => SCALE.has(px) || (px > 48 && px % 16 === 0);

/** Pixel values in padding, margin or gap that are off the R4.1 scale. */
export function offScaleSpacing(css: string): string[] {
  const hits: string[] = [];
  for (const m of css.matchAll(/(?:^|[\s;{])(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?:\s*([^;}]+)/g)) {
    for (const px of (m[1] ?? "").matchAll(/(?<![\w.])-?(\d*\.?\d+)px\b/g)) {
      if (!onScale(Number(px[1]))) hits.push(`${px[1]}px`);
    }
  }
  return hits;
}

/**
 * Hex and functional colours written outside a custom property (R1.3). A
 * `--name: #fff` declaration is a token and passes; `color: #fff` and a
 * `var(--x, #fff)` fallback do not.
 */
export function colourLiterals(css: string): string[] {
  const rules = css.replace(/--[\w-]+\s*:[^;}]*/g, "");
  return [...rules.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/g)].map((m) => m[0]);
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
  // A negative margin pulls back its own padding, so it sits on the scale too.
  assert.deepEqual(offScaleSpacing(".a { margin-inline: -6px; padding-inline: 8px; } .b { margin: 0 -12px; }"), ["6px"]);
  assert.deepEqual(offScaleSpacing(".a { padding: 8px 12px; margin: 0 auto; gap: 1px; } .b { --gap: 10px; }"), []);
});

test("the colour scanner finds hex, rgb, hsl and oklch but not a token or an id", () => {
  assert.deepEqual(colourLiterals(".a { color: #fff; background: rgba(0,0,0,.4); border-color: hsl(0 0% 0%); fill: oklch(70% .1 200); }"), ["#fff", "rgba(", "hsl(", "oklch("]);
  assert.deepEqual(colourLiterals(".a { color: var(--text); } #main { color: currentColor; }"), []);
});

test("a colour may define a custom property but not be a fallback or a value", () => {
  assert.deepEqual(colourLiterals(":root { --ink-red: #ff6666; --sh: 0 1px 2px rgb(0 0 0 / 8%); } .a { color: var(--ink-red); }"), []);
  assert.deepEqual(colourLiterals(".a { color: var(--danger, #c33); }"), ["#c33"]);
});

test("the spacing scale goes on in 16px steps past 48px", () => {
  assert.deepEqual(offScaleSpacing(".a { padding-bottom: 64px; margin: 96px auto; } .b { padding: 56px; }"), ["56px"]);
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

test("the scan covers the app, its feature styles and the pitch page", () => {
  for (const f of ["globals.css", "styles/base.css", "styles/brutal.css", "pitch/scrolly.module.css"]) assert.ok(allSheets.includes(f), f);
});

test("no stylesheet outside a palette writes a colour (G2)", () => {
  const found = allSheets
    .filter((f) => !GENERATED.has(f) && !PALETTES.has(f))
    .flatMap((f) => colourLiterals(readApp(f)).map((v) => `${f}: ${v}`));
  assert.deepEqual(found, [], "read a theme token, or define one in a theme file");
});

test("every padding, margin and gap is on the spacing scale (G4)", () => {
  const found = allSheets.filter((f) => !GENERATED.has(f)).flatMap((f) => offScaleSpacing(readApp(f)).map((v) => `${f}: ${v}`));
  assert.deepEqual(found, [], "use --s1..--s7 or a scale value");
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
