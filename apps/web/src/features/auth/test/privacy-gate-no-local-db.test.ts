import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// 0.9.8 has no local database. The privacy gate must not ask the desktop
// shell for local DB state or offer to reset a local DB.
const GATE = fileURLToPath(new URL("../ui/privacy-disclaimer-gate.tsx", import.meta.url));

test("privacy gate has no local-DB recovery calls", () => {
  const source = readFileSync(GATE, "utf8");
  for (const banned of ["localDbState", "resetLocalDb", "DesktopLocalDbState", "LocalDbRecovery", "useLocalDbFailure"]) {
    assert.equal(source.includes(banned), false, `privacy gate still references ${banned}`);
  }
});
