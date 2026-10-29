/**
 * The hover actions on a Files row (new note, new folder, rename) were the
 * 28px small icon button, which lifts with an offset shadow on hover. In a
 * 25px row that popped out of the row and was cut off. In a row they stay
 * flat: no lift, no shadow, and no taller than the row.
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

const ACTION = ":root:root .explorer-row .explorer-row-actions > .wf-btn.wf-icon";

test("a row action fits inside the row", () => {
  const rowHeight = Number(/height:\s*(\d+)px/.exec(rule(".explorer-row"))?.[1]);
  const size = rule(ACTION);
  const width = Number(/width:\s*(\d+)px/.exec(size)?.[1]);
  const height = Number(/(?<!-)height:\s*(\d+)px/.exec(size)?.[1]);
  // buttons.css gives a small button a 28px min-height; it must be undone here.
  assert.match(size, /min-height:\s*0/);
  assert.ok(height > 0 && height < rowHeight, `action ${height}px, row ${rowHeight}px`);
  assert.equal(width, height, "a square");
});

test("a row action never lifts or casts a shadow", () => {
  const state = rule(`${ACTION}:is(:hover, :active, [data-force~="hover"], [data-force~="press"])`);
  assert.match(state, /translate:\s*0 0/);
  assert.match(state, /box-shadow:\s*none/);
});
