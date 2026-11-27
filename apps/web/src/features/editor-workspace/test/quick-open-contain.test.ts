/**
 * Quick-open lists every document when the query is empty, so offscreen rows skip layout and paint.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const block = (css: string, selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `${selector} rule exists`);
  return css.slice(start, css.indexOf("\n}", start));
};

test("quick-open rows defer layout and paint when offscreen", () => {
  const rule = block(read("../../../app/styles/editor-workspace.css"), ".quick-open-group-rows > li");
  assert.match(rule, /^\s*content-visibility: auto;/m);
  assert.match(rule, /^\s*contain-intrinsic-size: auto 30px;/m);
});
