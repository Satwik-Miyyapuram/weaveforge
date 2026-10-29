/**
 * Motion steps on one scale (design D04, R3, G3): a control answers in 80ms,
 * fades and hovers take 160ms, and things that move across the screen take
 * 280ms. The three are tokens on :root, and no stylesheet writes another
 * duration under half a second.
 *
 * Half a second and up is a different kind of motion: spinners, pulses that
 * draw the eye to a jump target, and the pitch page's drawn lines and typed
 * text. Delays are not durations either: a stagger or a tooltip's wait says
 * when something starts, not how fast it moves.
 *
 * Curves are tokens too: a stylesheet names an easing, it does not write a
 * cubic-bezier, so the same ease reads the same everywhere.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const allSheets = ["", "styles", "pitch"].flatMap((dir) =>
  readdirSync(path.join(app, dir))
    .filter((f) => f.endsWith(".css"))
    .map((f) => (dir ? `${dir}/${f}` : f)),
);
const readApp = (f: string) => readFileSync(path.join(app, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Built from the design-system bundle; its motion tiers are fixed there. */
const GENERATED = new Set(["styles/states.css"]);

const SCALE = new Set([80, 160, 280]);
const DECL = /(?:^|[{;\s])(-{0,2}[a-z][\w-]*)\s*:\s*([^;{}]+)/g;
const TIME = /(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g;

/** Durations under 500ms that are not on the scale; delays and zero are fine. */
export function offScaleDurations(css: string): string[] {
  const found: string[] = [];
  for (const [, prop = "", value = ""] of css.matchAll(DECL)) {
    if (!/^(transition|animation)|^--/.test(prop) || /(delay|stagger)$/.test(prop)) continue;
    for (const [whole, num = "", unit] of value.matchAll(TIME)) {
      const ms = Number(num) * (unit === "s" ? 1000 : 1);
      if (ms < 1 || ms >= 500 || SCALE.has(ms)) continue;
      found.push(whole);
    }
  }
  return found;
}

/** A cubic-bezier written anywhere but the definition of a custom property. */
export function literalCurves(css: string): string[] {
  const found: string[] = [];
  for (const [, prop = "", value = ""] of css.matchAll(DECL)) {
    if (prop.startsWith("--")) continue;
    for (const m of value.matchAll(/cubic-bezier\([^)]*\)/g)) found.push(m[0]);
  }
  return found;
}

test("the duration scanner flags off-scale times and passes the scale, delays and loops", () => {
  assert.deepEqual(offScaleDurations(".a { transition: opacity 0.12s ease, color 160ms; }"), ["0.12s"]);
  assert.deepEqual(offScaleDurations(".a { --btn-dur: 120ms; animation: spin 1s linear infinite; }"), ["120ms"]);
  assert.deepEqual(offScaleDurations(".a { animation-duration: 140ms; animation-delay: 40ms; --wf-stagger: 18ms; }"), ["140ms"]);
  assert.deepEqual(offScaleDurations(".a { transition: opacity 280ms ease 600ms; --off: 0.01ms; width: 120px; }"), []);
});

test("the curve scanner flags a written bezier but not its token", () => {
  assert.deepEqual(literalCurves(":root { --ease-out: cubic-bezier(0.22, 0.61, 0.36, 1); } .a { transition: x 1s cubic-bezier(0.4, 0, 0.2, 1); }"), ["cubic-bezier(0.4, 0, 0.2, 1)"]);
});

test("the duration tokens are the R3 scale", () => {
  const base = readApp("styles/base.css");
  assert.match(base, /--dur-fast: calc\(80ms \/ var\(--anim-speed, 1\)\);/);
  assert.match(base, /--dur-base: calc\(160ms \/ var\(--anim-speed, 1\)\);/);
  assert.match(base, /--dur-slow: calc\(280ms \/ var\(--anim-speed, 1\)\);/);
  assert.match(base, /--layout-duration: var\(--dur-slow\);/);
});

test("every duration in the app is on the motion scale (G3)", () => {
  const found = allSheets.filter((f) => !GENERATED.has(f)).flatMap((f) => offScaleDurations(readApp(f)).map((v) => `${f}: ${v}`));
  assert.deepEqual(found, []);
});

test("no stylesheet writes a cubic-bezier outside a token (G3)", () => {
  const found = allSheets.filter((f) => !GENERATED.has(f)).flatMap((f) => literalCurves(readApp(f)).map((v) => `${f}: ${v}`));
  assert.deepEqual(found, []);
});

test("the timings scripts wait on match the stylesheet", () => {
  const src = (rel: string) => readFileSync(path.join(app, "..", rel), "utf8");
  assert.match(src("lib/hooks/use-layout-breakpoint.ts"), /const LAYOUT_TRANSITION_MS = 280;/);
  assert.match(src("features/dashboard/ui/dashboard-grid.tsx"), /const LAYOUT_TRANSITION_MS = 280;/);
  assert.match(src("features/dashboard/ui/dashboard-grid.tsx"), /const CARD_ENTER_MS = 160;/);
});
