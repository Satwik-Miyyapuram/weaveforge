/**
 * Picking Edit from a log entry's card menu swaps the card for the edit form.
 * The menu button is gone, so focus fell to the page body. The entry editor
 * takes focus once it is created.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const screen = readFileSync(fileURLToPath(new URL("../ui/logbook-screen.tsx", import.meta.url)), "utf8");

test("the edit form's editor is labelled and takes focus when created", () => {
  const helper = screen.match(/const labelEditor = [\s\S]*?\n\};/)?.[0] ?? "";
  assert.match(helper, /setAttribute\("aria-labelledby", labelId\)/);
  assert.match(helper, /view\.contentDOM\.focus\(\)/);
});
