/**
 * 0.9.8: the keychain copy is gone. It described a token path that no 0.9.8
 * copy ships, since no-account mode has no local database. The no-account view
 * no longer shows the Git-link disclosure at all: see overleaf-no-account.test.tsx.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui");

test("the keychain disclosure is no longer shown", () => {
  const source = readFileSync(path.join(uiDir, "overleaf-workspace.tsx"), "utf8");
  assert.doesNotMatch(source, /"[^"\n]*keychain/);
});
