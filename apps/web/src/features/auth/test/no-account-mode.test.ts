/**
 * The no-account choice lives in the files provider, not in the local database
 * provider. Same names, same storage key, so a stored choice still reads.
 * Static: the Rust core (wf-wasm pkg) is not generated in every worktree, so
 * the key and the read are checked in source, as the other auth tests do.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const DOMAIN = "../../../backend/providers/files/no-account-mode.ts";
const OLD = "../../../backend/providers/local/local-identity.ts";

test("the choice module exists and exports the same two names", () => {
  assert.ok(existsSync(fileURLToPath(new URL(DOMAIN, import.meta.url))));
  const src = read(DOMAIN);
  assert.match(src, /export function isLocalMode\(\): boolean/);
  assert.match(src, /export function setLocalMode\(on: boolean\): void/);
});

test("the choice keeps the storage key and read/write helpers", () => {
  const src = read(DOMAIN);
  assert.match(src, /readyCore\(\)\.localModeKey\(\)/);
  assert.match(src, /readyCore\(\)\.localIsLocalMode\(readStored\(choiceKey\(\)\) \?\? undefined\)/);
  assert.match(src, /writeStored\(choiceKey\(\), "1"\)/);
  assert.match(src, /removeStored\(choiceKey\(\)\)/);
});

test("the provider no longer defines the choice (its file is deleted)", () => {
  assert.equal(existsSync(fileURLToPath(new URL(OLD, import.meta.url))), false);
});
