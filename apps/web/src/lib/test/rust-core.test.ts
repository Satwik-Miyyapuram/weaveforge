import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadCore } from "../rust-core";

const wasm = readFileSync(new URL("../../../../../packages/wf-wasm/pkg/wf_wasm_bg.wasm", import.meta.url));
const cargo = readFileSync(new URL("../../../../../Cargo.toml", import.meta.url), "utf8");
const version = cargo.match(/^version = "([^"]+)"/m)?.[1];

test("a failed load is not cached; the next call retries", async () => {
  await assert.rejects(loadCore(new Uint8Array([0, 1, 2, 3])));
  const core = await loadCore(wasm);
  assert.deepEqual(core.coreInfo(), { version });
});

test("loadCore resolves to the initialised core module", async () => {
  assert.ok(version);
  const core = await loadCore(wasm);
  assert.deepEqual(core.coreInfo(), { version });
});

test("loadCore loads the module once", async () => {
  const a = loadCore(wasm);
  const b = loadCore(wasm);
  assert.equal(a, b);
  await a;
});
