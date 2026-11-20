import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

// The 0.8 -> 0.9 database import is removed. Nothing may prompt for it, call it, or register its
// commands. Old data and files on disk are left alone; this only guards the code paths.

const repo = resolve(process.cwd(), "../..");
const read = (rel: string) => readFileSync(resolve(repo, rel), "utf8");

test("the old database import files are gone", () => {
  for (const rel of [
    "apps/web/src/features/startup/application/import-old-db.ts",
    "apps/web/src/features/startup/ui/old-db-import-gate.tsx",
    "apps/web/src/features/startup/test/import-old-db.test.ts",
    "apps/shell/src/old_db.rs",
    "apps/shell/src/cmd_import.rs",
  ]) {
    assert.equal(existsSync(resolve(repo, rel)), false, `${rel} still exists`);
  }
});

test("the app shell does not show the import prompt", () => {
  const shell = read("apps/web/src/app/app-shell.tsx");
  assert.doesNotMatch(shell, /OldDbImportGate|old-db-import-gate/);
});

test("the web bridge has no old database members", () => {
  assert.doesNotMatch(read("apps/web/src/lib/desktop/desktop-bridge.ts"), /oldDb|OldDb/);
  assert.doesNotMatch(read("apps/shell/bridge/bridge.ts"), /oldDb/);
  assert.doesNotMatch(read("apps/shell/bridge/bindings.ts"), /oldDb|old_db_/);
});

test("the shell registers and declares no old database command", () => {
  assert.doesNotMatch(read("apps/shell/src/commands.rs"), /old_db_|cmd_import/);
  const lib = read("apps/shell/src/lib.rs");
  assert.doesNotMatch(lib, /pub mod cmd_import|pub mod old_db/);
});
