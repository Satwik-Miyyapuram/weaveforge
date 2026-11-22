/**
 * 0.9.8: the Git-link disclosure in no-account mode says Overleaf needs an
 * account, and the keychain copy is gone. The keychain copy described a token
 * path that no 0.9.8 copy ships, since no-account mode has no local database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui");

test("no-account disclosure shows the needs-an-account line", () => {
  const source = readFileSync(path.join(uiDir, "overleaf-workspace.tsx"), "utf8");
  assert.match(source, /import \{ OVERLEAF_NEEDS_ACCOUNT \} from "@\/features\/overleaf\/infrastructure\/local-overleaf-gateway";/);
  assert.match(source, /local\(\)\s*\?\s*\(?\s*OVERLEAF_NEEDS_ACCOUNT/);
});

test("the keychain disclosure is no longer shown", () => {
  const source = readFileSync(path.join(uiDir, "overleaf-workspace.tsx"), "utf8");
  assert.doesNotMatch(source, /"[^"\n]*keychain/);
});
