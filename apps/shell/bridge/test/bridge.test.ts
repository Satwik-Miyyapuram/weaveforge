import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromBase64, toBase64 } from "../bridge";

test("toBase64 and fromBase64 convert known bytes", () => {
  assert.equal(toBase64(new Uint8Array([0, 1, 2, 255])), "AAEC/w==");
  assert.deepEqual(fromBase64("AAEC/w=="), new Uint8Array([0, 1, 2, 255]));
});

test("toBase64 and fromBase64 handle empty input", () => {
  assert.equal(toBase64(new Uint8Array([])), "");
  assert.deepEqual(fromBase64(""), new Uint8Array([]));
});

test("base64 round-trips a large value and matches Buffer", () => {
  const bytes = new Uint8Array(100_000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 256;
  const text = toBase64(bytes);
  assert.equal(text, Buffer.from(bytes).toString("base64"));
  assert.deepEqual(fromBase64(text), bytes);
});

test("no shell bridge source names the removed local database members", () => {
  // The 0.9.8 shell has no db_query / db_state / db_reset commands, so nothing may wrap them.
  const removed =
    /localDbBridge|LocalDbCommands|LocalDbBridge|queryLocalDb|localDbState|resetLocalDb|dbQuery|dbState|dbReset|encodeParam|decodeWire/;
  for (const file of ["../inject.ts", "../bridge.ts", "../desktop.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, removed, file);
  }
});
