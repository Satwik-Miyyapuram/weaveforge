/**
 * Pins the WASM build's version check. The wasm-bindgen CLI must match the
 * Cargo.lock crate exactly, or the generated glue and the module disagree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cliVersion, inputDigest, lockedVersion, remapFlags } from "../wasm-build.mjs";
import { collectInputs } from "../wasm-inputs.mjs";

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

test("inputDigest ignores CRLF vs LF", () => {
  assert.equal(inputDigest([{ path: "a", text: "x\r\ny" }]), inputDigest([{ path: "a", text: "x\ny" }]));
});

test("inputDigest ignores input order", () => {
  const a = { path: "a", text: "1" };
  const b = { path: "b", text: "2" };
  assert.equal(inputDigest([a, b]), inputDigest([b, a]));
});

test("inputDigest treats backslash and slash paths alike", () => {
  assert.equal(
    inputDigest([{ path: "crates\\x.rs", text: "t" }]),
    inputDigest([{ path: "crates/x.rs", text: "t" }]),
  );
});

test("inputDigest changes when one byte changes", () => {
  assert.notEqual(inputDigest([{ path: "a", text: "x" }]), inputDigest([{ path: "a", text: "y" }]));
});

test("inputDigest separates path from text", () => {
  assert.notEqual(inputDigest([{ path: "ab", text: "c" }]), inputDigest([{ path: "a", text: "bc" }]));
});

test("inputDigest is 64 hex chars", () => {
  assert.match(inputDigest([{ path: "a", text: "" }]), /^[0-9a-f]{64}$/);
});

test("remapFlags maps cargo home and repo root", () => {
  assert.deepEqual(remapFlags("C:\\h\\.cargo", "C:\\repo"), [
    "--remap-path-prefix=C:\\h\\.cargo=/cargo",
    "--remap-path-prefix=C:\\repo=/weaveforge",
  ]);
});

test("collectInputs finds the wasm crate and skips target", () => {
  const paths = collectInputs(repoRoot).map((f) => f.path);
  assert.ok(paths.includes("crates/wf-wasm/src/lib.rs"));
  assert.ok(paths.includes("Cargo.lock"));
  assert.ok(paths.every((p) => !p.includes("/target/")));
  assert.ok(paths.every((p) => !p.includes("\\")));
});
