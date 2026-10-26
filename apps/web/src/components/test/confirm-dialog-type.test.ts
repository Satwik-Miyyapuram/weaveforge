/** Rule D-07: deleting a project asks the user to type its name first. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { confirmReady } from "../confirm-dialog";

test("with no text to type, the confirm button is ready", () => {
  assert.equal(confirmReady(undefined, ""), true);
});

test("the typed text must match the name, ignoring outer spaces", () => {
  assert.equal(confirmReady("Thesis", ""), false);
  assert.equal(confirmReady("Thesis", "thesis"), false, "case counts");
  assert.equal(confirmReady("Thesis", "Thes"), false);
  assert.equal(confirmReady("Thesis", "  Thesis "), true);
});

test("project delete asks for the project name", () => {
  const src = readFileSync(fileURLToPath(new URL("../../features/projects/ui/projects-screen.tsx", import.meta.url)), "utf8");
  assert.match(src, /requireText=\{removing\.name\}/);
});
