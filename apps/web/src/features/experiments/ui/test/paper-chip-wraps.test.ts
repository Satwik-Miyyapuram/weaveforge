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
  const rule = css.match(/\.chip-row--capped > \* \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /white-space:\s*nowrap/);
  assert.match(rule, /text-overflow:\s*ellipsis/);
});

test("capped chip rows wrap whole chips instead of shaving a few pixels off each", () => {
  const css = read("../../../../app/styles/entity-detail.css");
  const rule = css.match(/\n\.chip-row--capped \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /flex-wrap:\s*wrap/);
  assert.doesNotMatch(rule, /overflow:\s*hidden/);
});
