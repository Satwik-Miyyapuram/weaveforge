/**
 * On a phone the lists rail turns into wrapping pills. A pill could not
 * shrink below its one-line name, so "Related work — generative models" ran
 * past the rail's edge and was cut. A pill now fits the row and a long name
 * wraps inside it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../styles/lists.css", import.meta.url)), "utf8");
const phone = css.slice(css.indexOf("@media (max-width: 900px) {\n  .lists-two-pane"));

test("a phone list pill fits the row and wraps a long name", () => {
  assert.match(phone, /\.lists-rail > \.wf-row \{[^}]*max-width:\s*100%/);
  assert.match(phone, /\.lists-rail-name \{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/);
});
