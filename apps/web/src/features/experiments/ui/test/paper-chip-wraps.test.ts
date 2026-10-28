/**
 * A run's linked paper is a full title. In the card's one-line chip row it was
 * sliced mid-letter ("…Representations (SimC"); it wraps to two lines instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("the linked-paper chip is marked as the wrapping kind", () => {
  const src = read("../experiment-panels.tsx");
  const paper = src.slice(src.indexOf("function RelatedPaper"));
  assert.match(paper, /className="git-chip git-chip--paper"/);
});

test("in a capped chip row the paper chip wraps to two lines, not one cut line", () => {
  const css = read("../../../../app/styles/entity-detail.css");
  const rule = css.match(/\.chip-row--capped > \.git-chip--paper \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /white-space:\s*normal/);
  assert.match(rule, /-webkit-line-clamp:\s*2/);
});

test("capped chip rows wrap whole chips instead of shaving a few pixels off each", () => {
  const css = read("../../../../app/styles/entity-detail.css");
  const rule = css.match(/\n\.chip-row--capped \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /flex-wrap:\s*wrap/);
  assert.doesNotMatch(rule, /overflow:\s*hidden/);
});
