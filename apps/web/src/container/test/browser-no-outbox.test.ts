import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * P1-2 guard. The browser has no local outbox: browser writes go straight to the server, so
 * PostgrestSource.pendingOutbox() is a fixed 0. If a browser-reachable module starts using the
 * offline-sync Outbox or the desktop LocalRunner, this count must be revisited, so this test fails.
 */
const BROWSER_SWITCH_MODULES = [
  "../browser-export-switch.ts",
  "../browser-switch-wiring.ts",
  "../browser-file-backend.ts",
  "../../features/migration-097/infrastructure/postgrest-source.ts",
  "../../features/migration-097/application/run-web-export.ts",
  "../../features/migration-097/application/opfs-switch-gate.ts",
];

const FORBIDDEN = /offline-sync|backend\/providers\/local|LocalRunner|\bOutbox\b/;

test("(P1-2) no browser-switch module imports the offline outbox or local runner", () => {
  for (const rel of BROWSER_SWITCH_MODULES) {
    const source = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    const imports = source.split("\n").filter((line) => /^\s*(import|export)\b/.test(line));
    for (const line of imports) {
      assert.doesNotMatch(line, FORBIDDEN, `${rel} imports a browser outbox: ${line}`);
    }
  }
});
