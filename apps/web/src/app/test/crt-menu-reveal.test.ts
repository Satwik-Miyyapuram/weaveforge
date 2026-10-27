/**
 * In the crt theme a menu wipes in from its top edge. The wipe was a clip-path
 * left on the open panel, so anything drawn past the panel's edge was cut: the
 * account menu's lab switcher opened beside the panel as a 12px sliver. The
 * wipe now runs once as an animation and the open panel clips nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../styles/states.css", import.meta.url)), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The open-state crt rule for the shared popover family. */
function openRule(): string {
  const re = /^:root:root:root\[data-theme="crt"\] :is\(\.wf-pop, \.popover-panel[^{]*\)\s*\{([^}]*)\}/gm;
  const bodies = [...css.matchAll(re)].filter((m) => !m[0].includes("wf-closing")).map((m) => m[1]!);
  assert.equal(bodies.length, 1, "one open-state crt popover rule");
  return bodies[0]!;
}

test("an open crt menu clips nothing, so its flyouts show in full", () => {
  const body = openRule();
  assert.match(body, /clip-path:\s*none/);
  assert.doesNotMatch(body, /clip-path:\s*inset/);
  assert.doesNotMatch(body, /transition:[^;]*clip-path/);
});

test("the crt wipe still plays once on open", () => {
  assert.match(openRule(), /animation:\s*wf-crt-wipe\b/);
  const kf = css.match(/@keyframes wf-crt-wipe \{([\s\S]*?)\n\}/);
  assert.ok(kf, "a wf-crt-wipe keyframe");
  assert.match(kf[1]!, /from \{ clip-path: inset\(0 -12px 100% -12px\); \}/);
  assert.doesNotMatch(css, /@starting-style \{ :root:root:root\[data-theme="crt"\] :is\(\.wf-pop[^}]*clip-path/);
});

test("reduced motion skips the wipe", () => {
  const at = css.lastIndexOf("@media (prefers-reduced-motion: reduce)");
  const block = css.slice(at, css.indexOf("\n}", at));
  assert.match(block, /\[data-theme="crt"\][^{]*\.popover-panel[^{]*\{[^}]*animation:\s*none/);
});
