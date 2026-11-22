// 0.9.8 drops the shell's one-time secrets move: 0.9.7 always runs first, so the secrets are already in
// the keychain. The bridge type and its inject must not carry migrate097MoveSecrets.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../../../", import.meta.url);
const files = [
  "apps/shell/bridge/inject.ts",
  "apps/shell/bridge/desktop.ts",
  "apps/web/src/lib/desktop/desktop-bridge.ts",
  "apps/web/src/backend/providers/local/parts.ts",
];

for (const file of files) {
  test(`${file} has no migrate097MoveSecrets`, () => {
    const text = readFileSync(new URL(file, root), "utf8");
    assert.equal(text.includes("migrate097MoveSecrets"), false);
  });
}
