/**
 * The canvas bar is one row of compact controls: the global `input` and select
 * rules make both full width, which stretched the colour and width onto rows
 * of their own. These pin the bar's overrides.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../../../app/styles/canvas.css", import.meta.url)), "utf8");

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string | undefined {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? undefined : css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
}

test("the bar's colour picker is a small square, not a full-width input", () => {
  const body = rule('.canvas-editor__bar > input[type="color"]');
  assert.ok(body, "no colour input rule in canvas.css");
  assert.match(body, /width:\s*2rem/);
});

test("the bar's width select sizes to its content", () => {
  const body = rule(".canvas-editor__bar > .custom-select-container");
  assert.ok(body, "no width select rule in canvas.css");
  assert.match(body, /width:\s*auto/);
});
