/**
 * The CRT scanlines and vignette are the body's background, not a fixed
 * full-screen overlay. The overlay was its own window-sized GPU layer, and
 * everything under it had to be composited separately to keep it on top: about
 * 100 MB more than brutal-dark in the reader.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const styles = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(path.join(styles, "brutal.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  for (const block of css.split("}")) {
    const open = block.indexOf("{");
    if (open < 0) continue;
    if (block.slice(0, open).trim() === selector) return block.slice(open + 1);
  }
  assert.fail(`no rule for ${selector}`);
}

test("CRT has no fixed full-screen overlay", () => {
  assert.doesNotMatch(css, /data-theme="crt"[^{}]*body::after/);
});

test("CRT scanlines and vignette are the body's background image", () => {
  const body = rule(':root[data-theme="crt"]:not([data-scanlines="off"]) body');
  assert.match(body, /background-image:[^;]*repeating-linear-gradient\(/);
  assert.match(body, /background-image:[^;]*radial-gradient\(/);
  assert.doesNotMatch(body, /position:\s*fixed/);
});

test("printing CRT drops the scanlines", () => {
  assert.match(css, /@media print\s*\{\s*:root\[data-theme="crt"\] body\s*\{\s*background-image:\s*none/);
});
