import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * P1-2 guard. The browser has no local outbox: browser writes go straight to the server, so
 * PostgrestSource.pendingOutbox() is a fixed 0. If a browser-reachable module starts using the
 * offline-sync Outbox or the desktop LocalRunner, this count must be revisited, so this test fails.
 */

// Hand-kept list: add a module here when the browser switch starts to depend on it.
const BROWSER_SWITCH_MODULES = [
  "../browser-export-switch.ts",
  "../browser-switch-wiring.ts",
  "../browser-file-backend.ts",
  "../../features/migration-097/infrastructure/postgrest-source.ts",
  "../../features/migration-097/application/run-web-export.ts",
  "../../features/migration-097/application/opfs-switch-gate.ts",
];

const FORBIDDEN = /offline-sync|backend\/providers\/local|LocalRunner|outbox/i;

const STATIC_FROM = /\bfrom\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']/g;

/** Every module specifier in the source: multi-line static imports and dynamic imports included. */
export function moduleSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const re of [STATIC_FROM, DYNAMIC_IMPORT]) {
    for (const match of source.matchAll(re)) if (match[1]) found.push(match[1]);
  }
  return found;
}

test("(P1-2) no browser-switch module imports the offline outbox or local runner", () => {
  for (const rel of BROWSER_SWITCH_MODULES) {
    const source = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    for (const specifier of moduleSpecifiers(source)) {
      assert.doesNotMatch(specifier, FORBIDDEN, `${rel} imports a browser outbox: ${specifier}`);
    }
  }
});

test("(P1-2) the guard catches a multi-line static import and a dynamic import", () => {
  const multiLine = 'import {\n  Thing,\n} from "../../offline-sync/outbox";\n';
  const dynamic = 'const m = await import("../backend/providers/local/runner");\n';
  assert.deepEqual(moduleSpecifiers(multiLine), ["../../offline-sync/outbox"]);
  assert.deepEqual(moduleSpecifiers(dynamic), ["../backend/providers/local/runner"]);
  assert.match(moduleSpecifiers(multiLine)[0] ?? "", FORBIDDEN);
  assert.match(moduleSpecifiers(dynamic)[0] ?? "", FORBIDDEN);
});
