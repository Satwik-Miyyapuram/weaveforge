/** The dashboard's customize button is the catalogue icon button (E43). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../ui/dashboard-edit-bar.tsx", import.meta.url)), "utf8");

test("the customize button is an IconButton, so it sizes like every icon button", () => {
  assert.match(src, /<IconButton label="Customize dashboard" tip="Customize"/);
  assert.doesNotMatch(src, /dashboard-customize-btn/);
});
