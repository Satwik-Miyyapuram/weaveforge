/**
 * The offline-sync feature is removed in 0.9.8 (its outbox and sync loop were the
 * personal-row server path). Nothing under apps/web/src may import it again.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'][^"']*offline-sync[^"']*["']/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) ? [full] : [];
  });
}

test("apps/web/src has no import of the removed offline-sync feature", () => {
  const offenders = sourceFiles(SRC)
    .filter((file) => IMPORT.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file));
  assert.deepEqual(offenders, []);
});
