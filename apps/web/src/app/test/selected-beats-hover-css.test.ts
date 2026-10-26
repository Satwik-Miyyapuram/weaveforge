/** A selected pill or tool stays selected under the pointer (DA-03, E22). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const states = readFileSync(fileURLToPath(new URL("../styles/states.css", import.meta.url)), "utf8");

/** The hover and press rules of one primitive, by their selector start. */
function interactionRules(prefix: string): string[] {
  return states
    .split("\n")
    .filter((line) => line.startsWith(prefix) && /:is\((:hover|:active)/.test(line));
}

for (const [name, prefix] of [
  ["segmented pill", ':root:root :is(.wf-seg, .seg) > button:is(:'],
  ["tool", ":root:root :is(.wf-tool, .ink-tool, .pdf-reader-create-icon, .pdf-reader-pop-btn):is(:"],
] as const) {
  test(`${name} hover and press skip the selected state`, () => {
    const rules = interactionRules(prefix);
    assert.equal(rules.length, 2, `expected hover + press rules for ${name}`);
    for (const r of rules) {
      // Same specificity as the selected rule would lose on order; excluding
      // the selected states from hover keeps selected colours under the pointer.
      assert.match(r, /:not\([^)]*\[aria-pressed="true"\][^)]*\[aria-selected="true"\]/);
    }
  });
}
