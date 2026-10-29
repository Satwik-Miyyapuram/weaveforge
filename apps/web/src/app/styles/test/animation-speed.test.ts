/**
 * Settings → Appearance → Animation speed: one multiplier, 0.25x to 4x, that
 * reaches every animation the app times with a token.
 *
 * `--anim-speed` sits on <html> (1 when unset). Every duration token divides
 * by it: the R3 scale (`--dur-*`, which the reactive ramp derives from) and
 * the control tiers (`--wf-t*`). Reduced motion still zeroes the tiers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ANIMATION_SPEED_OPTIONS,
  applyAnimationSpeed,
  sanitizeAnimationSpeed,
  THEME_BOOT_SCRIPT,
} from "@/lib/theme/theme";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (f: string) => readFileSync(path.join(src, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

test("speeds run 0.25x to 4x, and anything else reads as 1x", () => {
  assert.deepEqual(ANIMATION_SPEED_OPTIONS.map((o) => o.id), [0.25, 0.5, 1, 2, 4]);
  assert.deepEqual(ANIMATION_SPEED_OPTIONS.map((o) => o.label), ["0.25×", "0.5×", "1×", "2×", "4×"]);
  for (const ok of [0.25, 0.5, 1, 2, 4]) assert.equal(sanitizeAnimationSpeed(String(ok)), ok);
  for (const bad of [null, "", "3", "abc", "0", "-2", "8"]) assert.equal(sanitizeAnimationSpeed(bad), 1, String(bad));
});

test("applying a speed sets --anim-speed on <html>, and 1x clears it", () => {
  const props = new Map<string, string>();
  const style = { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => void props.delete(k) };
  const g = globalThis as Record<string, unknown>;
  const saved = g.document;
  g.document = { documentElement: { style } };
  try {
    applyAnimationSpeed(4);
    assert.equal(props.get("--anim-speed"), "4");
    applyAnimationSpeed(1);
    assert.equal(props.has("--anim-speed"), false);
  } finally {
    g.document = saved;
  }
});

test("the boot script sets a stored speed before first paint, checked against the list", () => {
  assert.match(THEME_BOOT_SCRIPT, /localStorage\.getItem\("thesis\.animationSpeed"\)/);
  assert.match(THEME_BOOT_SCRIPT, /\[0\.25,0\.5,2,4\]\.indexOf\(as\)>=0/);
  assert.match(THEME_BOOT_SCRIPT, /setProperty\("--anim-speed",String\(as\)\)/);
});

test("every duration token divides by --anim-speed", () => {
  const base = read("app/styles/base.css");
  for (const [n, v] of [["fast", 80], ["base", 160], ["slow", 280]] as const) {
    assert.match(base, new RegExp(String.raw`--dur-${n}: calc\(${v}ms / var\(--anim-speed, 1\)\);`));
  }
  const states = read("app/styles/states.css");
  const tiers = [...states.matchAll(/(--wf-t(?:-[a-z]+)?|--wf-stagger):\s*([^;]+);/g)];
  assert.ok(tiers.length > 10);
  for (const [, name, value = ""] of tiers) {
    if (value.trim() === "0ms") continue; // reduced motion and the stagger's off state
    assert.match(value, /^calc\(\d+ms \/ var\(--anim-speed, 1\)\)$/, `${name}: ${value}`);
  }
});

test("Appearance offers the speed as a select", () => {
  const panel = read("features/settings/ui/appearance-panel.tsx");
  assert.match(panel, /<label htmlFor="animationSpeed">Animation speed<\/label>/);
  assert.match(panel, /ANIMATION_SPEED_OPTIONS\.map/);
  assert.match(panel, /persistThemeChange\(\{ animationSpeed: safe \}\)/);
});
