import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 0.9.8 has no local database. The no-account flag stays: it now means files
 * mode (backend/providers/files). This guards both halves:
 * (a) no source file imports the local database provider, PGlite or local-pg,
 *     or uses LocalRunner or the old badge;
 * (b) the flag is read only through backend/providers/files/no-account-mode.
 */

const SRC = fileURLToPath(new URL("../../../", import.meta.url));
const FLAG_MODULE = join("backend", "providers", "files", "no-account-mode.ts");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const sources = walk(SRC)
  .filter((f) => /\.(ts|tsx|css)$/.test(f))
  .filter((f) => !/\.test\.tsx?$/.test(f));

// Test-only helpers that run SQL on an in-memory PGlite. Named one by one, so a
// new file under a test folder is still checked.
const TEST_DB_HELPERS = new Set([
  join("backend", "test", "contracts", "harness.ts"),
  join("backend", "test", "pg-test-db.ts"),
  join("backend", "test", "pglite-client.ts"),
  join("features", "org", "infrastructure", "test", "schema-hardening.rls.integration.ts"),
]);

function offenders(pattern: RegExp, except: (rel: string) => boolean = () => false): string[] {
  return sources
    .map((f) => relative(SRC, f))
    .filter((rel) => !except(rel))
    .filter((rel) => pattern.test(readFileSync(join(SRC, rel), "utf8")));
}

test("no source file imports the local database or uses LocalRunner or the badge", () => {
  const LOCAL_DB = /["'`][^"'`\n]*(?:backend\/providers\/local\/|pglite|local-pg|local_pg)[^"'`\n]*["'`]|\bLocalRunner\b|LocalModeBadge|local-mode-badge/i;
  assert.deepEqual(offenders(LOCAL_DB, (rel) => TEST_DB_HELPERS.has(rel)), []);
});

test("the no-account flag is read only through the files provider", () => {
  assert.equal(existsSync(join(SRC, "features", "auth", "infrastructure", "no-account-mode.ts")), false);
  assert.deepEqual(offenders(/features\/auth\/infrastructure\/no-account-mode/), []);
  const READS_FLAG = /\blocalModeKey\(|\blocalIsLocalMode\(|["']weaveforge\.local-mode["']/;
  assert.deepEqual(offenders(READS_FLAG, (rel) => rel === FLAG_MODULE), []);
  assert.match(readFileSync(join(SRC, FLAG_MODULE), "utf8"), /export function isLocalMode\(\): boolean/);
});
