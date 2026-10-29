/**
 * Pins the WASM build's version check. The wasm-bindgen CLI must match the
 * Cargo.lock crate exactly, or the generated glue and the module disagree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cliVersion, lockedVersion } from "../wasm-build.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const LOCK = [
  "[[package]]",
  'name = "wasm-bindgen-macro"',
  'version = "0.2.129"',
  "",
  "[[package]]",
  'name = "wasm-bindgen"',
  'version = "0.2.129"',
  "",
].join("\n");

test("finds the exact crate, not a prefix match", () => {
  assert.equal(lockedVersion(LOCK, "wasm-bindgen"), "0.2.129");
  const prefixOnly = LOCK.replace('version = "0.2.129"\n\n[[package]]', 'version = "1.0.0"\n\n[[package]]')
    .replace('name = "wasm-bindgen"\nversion = "0.2.129"', 'name = "wasm-bindgen"\nversion = "9.9.9"');
  assert.equal(lockedVersion(prefixOnly, "wasm-bindgen"), "9.9.9");
});

test("returns null when the crate is absent", () => {
  assert.equal(lockedVersion(LOCK, "wasm-bindgen-shared"), null);
});

test("handles CRLF line endings", () => {
  assert.equal(lockedVersion(LOCK.replace(/\n/g, "\r\n"), "wasm-bindgen"), "0.2.129");
});

test("parses the CLI version line", () => {
  assert.equal(cliVersion("wasm-bindgen 0.2.129\n"), "0.2.129");
  assert.equal(cliVersion("garbage"), null);
});

test("the Cargo.toml pin matches the Cargo.lock version in this repo", () => {
  const toml = readFileSync(path.join(repoRoot, "Cargo.toml"), "utf8");
  const pin = toml.match(/^wasm-bindgen = "=([^"]+)"/m);
  assert.ok(pin, "Cargo.toml has no wasm-bindgen pin");
  const lock = readFileSync(path.join(repoRoot, "Cargo.lock"), "utf8");
  assert.equal(lockedVersion(lock, "wasm-bindgen"), pin[1]);
});
