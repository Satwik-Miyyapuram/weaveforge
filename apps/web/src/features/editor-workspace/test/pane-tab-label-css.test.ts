/**
 * A workspace tab was capped at 200px. Its file extension (".note.md") always
 * shows, since two tabs can share a title, so an ordinary name such as
 * "Ablation plan" was cut to "Ablati…". The cap leaves room for a typical name
 * and its extension; only a long name ends in an ellipsis.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../../../app/styles/editor-workspace.css", import.meta.url)), "utf8");
const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, selector);
  return css.slice(at, css.indexOf("}", at));
};

test("a tab fits a typical name beside its extension", () => {
  const max = Number(/max-width:\s*(\d+)px/.exec(rule(".pane-tab"))?.[1]);
  // icon 14 + name 114 + extension 56 + close 16 + gaps 24 - 4 + padding 24
  assert.ok(max >= 248, `max-width ${max}`);
  assert.match(rule(".pane-tab-ext"), /flex:\s*none/);
  assert.match(rule(".pane-tab-label"), /text-overflow:\s*ellipsis/);
});
