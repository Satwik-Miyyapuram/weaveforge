import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadCore, readyCore } from "../rust-core";

const wasm = readFileSync(new URL("../../../../../packages/wf-wasm/pkg/wf_wasm_bg.wasm", import.meta.url));
const cargo = readFileSync(new URL("../../../../../Cargo.toml", import.meta.url), "utf8");
const version = cargo.match(/^version = "([^"]+)"/m)?.[1];

// The preload has initialised the core in this process, and wasm-bindgen keeps
// the first module it gets, so the failed load runs in a fresh process.
const retryScript = `
const { loadCore } = await import("./src/lib/rust-core.ts");
const { readFileSync } = await import("node:fs");
let failed = false;
try { await loadCore(new Uint8Array([0, 1, 2, 3])); } catch { failed = true; }
const core = await loadCore(readFileSync("../../packages/wf-wasm/pkg/wf_wasm_bg.wasm"));
console.log(JSON.stringify({ failed, info: core.coreInfo() }));
`;

test("a failed load is not cached; the next call retries", () => {
  const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", retryScript], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(out.trim().split("\n").at(-1) ?? ""), { failed: true, info: { version } });
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

test("readyCore returns the core once loadCore has resolved", async () => {
  const core = await loadCore(wasm);
  assert.equal(readyCore(), core);
});
