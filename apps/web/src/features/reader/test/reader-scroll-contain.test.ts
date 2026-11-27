/**
 * The PDF scroller is a paint-containment boundary (fewer compositor layers,
 * less tile memory), and the pane around it is not: there, containment would
 * become the containing block of the fixed reference popover and focus mode.
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

test("the PDF scroller contains its paint", () => {
  assert.match(block(read("../../../app/styles/reader.css"), ".pdf-reader-scroll"), /^\s*contain: paint;/m);
});

test("the paper PDF pane does not contain paint", () => {
  assert.doesNotMatch(block(read("../../../app/styles/editor-workspace.css"), ".paper-pdf-pane"), /contain:/);
});
