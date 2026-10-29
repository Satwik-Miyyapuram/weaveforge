/** Base rules every control inherits: font, focus ring, scroll room (design D01). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const base = read("../styles/base.css");
const forms = read("../styles/forms.css");
const markdown = read("../styles/markdown.css");
const nav = read("../styles/nav.css");
const titleBar = read("../styles/title-bar.css");
const states = read("../styles/states.css");
const workspace = read("../styles/editor-workspace.css");

/** Declarations of the rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `missing rule ${selector}`);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
}

test("native controls inherit the app font (DA-01, E05)", () => {
  assert.match(rule(base, "button, input, select, textarea"), /font:\s*inherit;/);
});

test("focused controls are not hidden under the title bar (DA-02, E18)", () => {
  assert.match(base, /html\s*\{[^}]*scroll-padding-top:\s*calc\(var\(--titlebar-h\)\s*\+\s*8px\)/);
});

test("one focus ring: 3px, 2px offset, the shared focus token (DA-04)", () => {
  const body = rule(base, ":focus-visible");
  assert.match(body, /outline:\s*3px solid var\(--wf-focus, var\(--accent\)\);/);
  assert.match(body, /outline-offset:\s*2px;/);
});

test("the focus halo appears at once, not over a fade (DA-22)", () => {
  for (const css of [forms, markdown]) {
    assert.doesNotMatch(css, /transition:[^;]*box-shadow/);
  }
});

test("source text shows `<!--` as typed, not as a ligature (DA-05)", () => {
  assert.match(rule(base, ":root :is(code, pre, kbd, samp, .cm-content)"), /font-variant-ligatures:\s*none;/);
});

test("nav and title-bar buttons keep the shared keyboard ring (DA-04, E18)", () => {
  // Both are catalogue buttons now: the one ring lives in states.css, and
  // neither stylesheet may switch it off for keyboard focus.
  assert.match(states, /\.wf-btn,[^{]*:focus-visible[^{]*\{[^}]*outline: 3px solid var\(--wf-focus\)/);
  for (const css of [nav, titleBar]) assert.doesNotMatch(css, /:focus-visible[^{]*\{[^}]*outline:\s*none/);
});

test("the workspace editor pane rings while it has focus (DA-04)", () => {
  assert.match(rule(workspace, ".md-live-host > .workspace-editor:focus-within"), /outline:\s*3px solid var\(--wf-focus, var\(--accent\)\);/);
});
