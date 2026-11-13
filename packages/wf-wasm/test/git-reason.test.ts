import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { gitReason } from "../src/index.js";
import { initSync } from "../src/index.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

test("gitReason joins git's error lines and falls back to the first line", () => {
  assert.equal(gitReason("Running\nfatal: a bad ref\nerror: push rejected"), "fatal: a bad ref error: push rejected");
  assert.equal(gitReason("index.lock exists"), "index.lock exists");
  assert.equal(gitReason(""), "Could not commit.");
});
