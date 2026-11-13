import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { decodeBase64, decodeBytea, encodeBase64, encodeBytea } from "../src/index.js";

const pkgDir = new URL("../pkg/", import.meta.url);

before(() => {
  initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });
});

test("bytea hex round-trips and reads the PostgREST prefix", () => {
  assert.equal(encodeBytea(new Uint8Array([10, 255])), "\\x0aff");
  assert.deepEqual(decodeBytea("\\x0aff"), new Uint8Array([10, 255]));
  assert.deepEqual(decodeBytea("0aff"), new Uint8Array([10, 255]));
});

test("a Uint8Array passes through decodeBytea unchanged", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(decodeBytea(bytes), bytes);
});

test("base64 matches the atob/btoa output", () => {
  assert.equal(encodeBase64(new TextEncoder().encode("Man")), "TWFu");
  assert.equal(encodeBase64(new TextEncoder().encode("Ma")), btoa("Ma"));
  const decoded = decodeBase64("TWE=");
  assert.ok(decoded instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(decoded), "Ma");
});

test("large payloads encode without overflowing the call stack", () => {
  const bytes = new Uint8Array(200_000).map((_, i) => i % 251);
  assert.deepEqual(decodeBase64(encodeBase64(bytes)), bytes);
});
