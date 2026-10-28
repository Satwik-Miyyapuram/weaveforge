/**
 * The wiki screen has three cards: Draft, Health and Recently approved. In a
 * plain two-column grid Recently approved started below the taller Health
 * card, leaving a gap under Draft, and below 1000px all three stacked in one
 * column, so a tablet showed one wide card per row. Health now takes the right
 * column on its own while the other two stack tight on the left, from tablet
 * widths up.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../../../app/styles/entity-detail.css", import.meta.url)), "utf8");
const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, selector);
  return css.slice(at, css.indexOf("}", at));
};

test("health spans both rows so recent sits right under draft", () => {
  const layout = rule(".wiki-layout");
  assert.match(layout, /grid-template-areas:\s*"draft health"\s*"recent health"/);
  // The second row takes the slack, so the first is only as tall as Draft.
  assert.match(layout, /grid-template-rows:\s*auto 1fr/);
  assert.match(rule(".wiki-draft"), /grid-area:\s*draft/);
  assert.match(rule(".wiki-health"), /grid-area:\s*health/);
  assert.match(rule(".wiki-recent"), /grid-area:\s*recent/);
});

test("a tablet keeps two columns; only a phone stacks them", () => {
  assert.doesNotMatch(css, /@media \(max-width: 1000px\) \{ \.wiki-layout/);
  const m = /@media \(max-width: (\d+)px\) \{\s*\.wiki-layout \{([^}]*)\}/.exec(css);
  assert.ok(m, "a stacking breakpoint");
  assert.ok(Number(m[1]) < 768, `stacks at ${m[1]}px`);
  assert.match(m[2] ?? "", /grid-template-areas:\s*"draft"\s*"health"\s*"recent"/);
});
