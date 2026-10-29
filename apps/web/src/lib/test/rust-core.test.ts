import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadCoreInfo } from "../rust-core";

const wasm = readFileSync(new URL("../../../../../packages/wf-wasm/pkg/wf_wasm_bg.wasm", import.meta.url));
const cargo = readFileSync(new URL("../../../../../Cargo.toml", import.meta.url), "utf8");
const version = cargo.match(/^version = "([^"]+)"/m)?.[1];

test("loadCoreInfo returns the Rust core version", async () => {
  assert.ok(version);
  assert.deepEqual(await loadCoreInfo(wasm), { version });
});

test("loadCoreInfo loads the module once", async () => {
  const a = loadCoreInfo(wasm);
  const b = loadCoreInfo(wasm);
  assert.equal(a, b);
  await a;
});
