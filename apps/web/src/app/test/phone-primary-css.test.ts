/**
 * On a phone every list screen places its main action the same way (DA-94):
 * search on its own row, the primary button full width under it, the rest
 * sharing a row after. Papers had a half-width primary, Plan and Log squeezed
 * it beside the search.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

function phoneBlock(css: string): string {
  const at = css.indexOf("@media (max-width: 479px)");
  assert.ok(at >= 0, "no phone block");
  return css.slice(at, css.indexOf("\n}\n", at));
}

test("on a phone the primary action takes a full row right under the search", () => {
  const phone = phoneBlock(read("../styles/dashboard.css"));
  assert.match(phone, /\.screen-actions > \.search-input \{[^}]*flex: 1 1 100%[^}]*order: -2/);
  assert.match(phone, /\.screen-actions > \.wf-primary \{[^}]*flex: 1 1 100%[^}]*order: -1/);
});

test("Plan and Log keep search and add on one row only where there is room", () => {
  const css = read("../styles/entity-detail.css");
  assert.doesNotMatch(css, /@media \(max-width: 900px\) \{\s*:is\(\.plan-screen, \.log-screen\) \.screen-actions \{ flex-wrap: nowrap/);
  assert.match(css, /@media \(min-width: 480px\) and \(max-width: 900px\) \{\s*:is\(\.plan-screen, \.log-screen\) \.screen-actions \{ flex-wrap: nowrap/);
});
