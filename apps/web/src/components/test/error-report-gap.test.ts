/**
 * FormError and InlineError put a "Report" link right after the message. The
 * link had no margin, so a failed load read "injected failureReport". The
 * link keeps a gap from the message text.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../../app/styles/buttons.css", import.meta.url)), "utf8");

test("the Report link after an error message keeps a gap", () => {
  assert.match(css, /\.error > \.wf-link\s*\{[^}]*margin-left:\s*(0\.\d*[1-9]|[1-9])/);
});
