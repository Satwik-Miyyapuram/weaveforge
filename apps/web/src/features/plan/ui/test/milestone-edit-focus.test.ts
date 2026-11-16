/**
 * Picking Edit from a milestone's card menu swaps the card for the form. The
 * menu button is gone, so focus fell to the page body and a keyboard user had
 * to tab in from the top. The form's title field takes focus when editing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const form = readFileSync(fileURLToPath(new URL("../milestone-form.tsx", import.meta.url)), "utf8");

test("the title field takes focus when the form edits a milestone", () => {
  const input = form.match(/<input\s+id=\{`mtitle-[\s\S]*?\/>/)?.[0] ?? "";
  assert.match(input, /autoFocus=\{!!initial\}/);
});
