/** Text <-> Ink is instant: a mode switch reloads the notes list only for Read after a save. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { refreshOnModeChange } from "../ui/vault-screen/note-mode-refresh";

test("Text and Ink swap without a list reload, saved or not", () => {
  for (const next of ["edit", "ink"]) {
    assert.equal(refreshOnModeChange(next, false), false);
    assert.equal(refreshOnModeChange(next, true), false);
  }
});

test("Read reloads the list only when the body was saved", () => {
  assert.equal(refreshOnModeChange("read", true), true);
  assert.equal(refreshOnModeChange("read", false), false);
});

test("the note editor asks the rule, and a saved note reloads the list when it closes", () => {
  const src = readFileSync(fileURLToPath(new URL("../ui/vault-screen/page-editor.tsx", import.meta.url)), "utf8");
  const choose = src.slice(src.indexOf("function chooseMode"), src.indexOf("const words"));
  assert.match(choose, /refreshOnModeChange\(next, savedRef\.current\)/);
  assert.doesNotMatch(choose, /mode !== "read"\) void onChanged/, "no reload on every leave of Text or Ink");
  assert.match(src, /savedRef\.current = true/, "a stored body marks the list stale");
  assert.match(src, /\(\) => \(\) => \{\s*if \(savedRef\.current\)/, "closing a saved note reloads the list");
});
