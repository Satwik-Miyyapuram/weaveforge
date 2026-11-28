import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { rust } from "@weaveforge/core";
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

// 0.9.8: instantiateStreaming finishes on the main thread (v8.wasm.compileConsumeDone)
// and stalled about one cold load in eight for 2-5 s. The app fetches the whole
// file and instantiates the bytes instead.
const fetchScript = `
const { readFileSync } = await import("node:fs");
const bytes = readFileSync("../../packages/wf-wasm/pkg/wf_wasm_bg.wasm");
const fetched = [];
let streamed = 0;
globalThis.fetch = async (url) => { fetched.push(String(url)); return new Response(bytes, { headers: { "content-type": "application/wasm" } }); };
WebAssembly.instantiateStreaming = async () => { streamed++; throw new Error("streamed"); };
WebAssembly.compileStreaming = async () => { streamed++; throw new Error("streamed"); };
const { loadCore } = await import("./src/lib/rust-core.ts");
const core = await loadCore();
console.log(JSON.stringify({ streamed, fetched: fetched.map((u) => u.split("/").pop()), info: core.coreInfo() }));
`;

test("with no bytes given, loadCore fetches the .wasm whole and never streams it", () => {
  const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", fetchScript], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(out.trim().split("\n").at(-1) ?? ""), {
    streamed: 0,
    fetched: ["wf_wasm_bg.wasm"],
    info: { version },
  });
});

const failScript = `
globalThis.fetch = async () => new Response("nope", { status: 404, statusText: "Not Found" });
const { loadCore } = await import("./src/lib/rust-core.ts");
try { await loadCore(); console.log(JSON.stringify({ error: null })); }
catch (e) { console.log(JSON.stringify({ error: String(e.message) })); }
`;

test("a failed .wasm fetch rejects with its status", () => {
  const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", failScript], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    encoding: "utf8",
  });
  const { error } = JSON.parse(out.trim().split("\n").at(-1) ?? "") as { error: string | null };
  assert.match(error ?? "", /404 Not Found/);
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

test("loadCore hands the core to packages/core, so core glue calls Rust", async () => {
  await loadCore(wasm);
  assert.equal(rust().normalizeDoi("https://doi.org/10.1145/3592979"), "10.1145/3592979");
});
