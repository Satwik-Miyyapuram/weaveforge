import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { vaultRootFromText } from "../src/index.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

test("a non-empty vaultRoot string is returned", () => {
  assert.equal(vaultRootFromText('{"vaultRoot":"/Users/me/WeaveForge"}'), "/Users/me/WeaveForge");
});

test("a missing, empty or non-string vaultRoot, or bad JSON, is null", () => {
  assert.equal(vaultRootFromText('{"vaultRoot":""}'), null);
  assert.equal(vaultRootFromText('{"vaultRoot":null}'), null);
  assert.equal(vaultRootFromText("{}"), null);
  assert.equal(vaultRootFromText("not json"), null);
});
