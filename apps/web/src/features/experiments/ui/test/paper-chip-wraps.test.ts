/**
 * A run's linked paper is a full title. Chips never wrap, so in a capped row
 * it ends in an ellipsis, and its tooltip carries the whole title.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("the linked-paper chip is a plain chip whose tooltip names the whole paper", () => {
  const src = read("../experiment-panels.tsx");
  const paper = src.slice(src.indexOf("function RelatedPaper"));
  assert.match(paper, /<Chip title=\{`Paper this run tests\/implements: \$\{title\}`\}>/);
});

test("in a capped chip row a chip ends in an ellipsis on one line", () => {
  const css = read("../../../../app/styles/entity-detail.css");
  // `:root:root .wf-chip` makes a chip inline-flex, where text-overflow does
  // nothing; this rule must outrank it (0,4,0 over 0,3,0) to make it a block.
  const rule = css.match(/:root:root \.chip-row--capped > :is\(\*, \.wf-chip\) \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /display:\s*block/);
  assert.match(rule, /min-width:\s*0/);
  assert.match(rule, /max-width:\s*100%/);
  assert.match(rule, /overflow:\s*hidden/);
  assert.match(rule, /white-space:\s*nowrap/);
  assert.match(rule, /text-overflow:\s*ellipsis/);
});

test("capped chip rows wrap whole chips instead of shaving a few pixels off each", () => {
  const css = read("../../../../app/styles/entity-detail.css");
  const rule = css.match(/\n\.chip-row--capped \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /flex-wrap:\s*wrap/);
  assert.doesNotMatch(rule, /overflow:\s*hidden/);
});

test("a capped chip row stays inside its card (a grid item would grow to its longest chip)", () => {
  const css = read("../../../../app/styles/entity-detail.css");
  const rule = css.match(/\n\.chip-row--capped \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /min-width:\s*0/);
});
