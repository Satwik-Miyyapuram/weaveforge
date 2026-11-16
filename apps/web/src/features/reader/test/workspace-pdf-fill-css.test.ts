/**
 * The PDF reader's layout inside a workspace pane. The reader fills the pane
 * down to the status bar, and the scroller is not capped to the reader page's
 * own header height.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../../../app/styles/reader.css", import.meta.url)), "utf8");

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  for (const block of css.split("}")) {
    const open = block.indexOf("{");
    if (open < 0) continue;
    const head = block.slice(0, open).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (head === selector) return block.slice(open + 1);
  }
  assert.fail(`no rule for ${selector}`);
}

test("the reader fills its workspace pane", () => {
  const body = rule(".workspace-shell .pdf-reader");
  assert.match(body, /flex:\s*1/);
  assert.match(body, /height:\s*100%/);
  assert.match(body, /min-height:\s*0/);
});

test("the reader body fills the pane's height", () => {
  const body = rule(".workspace-shell .pdf-reader-body");
  assert.match(body, /flex:\s*1/);
  assert.match(body, /min-height:\s*0/);
});

test("the scroller is not capped to the reader page's header height in a pane", () => {
  assert.match(rule(".workspace-shell .pdf-reader-scroll"), /max-height:\s*none/);
});
