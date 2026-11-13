import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { syncFieldShown } from "../src/index.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

test("the token field is hidden only in Mattermost sign-in mode", () => {
  assert.equal(syncFieldShown("token", true), false);
  assert.equal(syncFieldShown("token", false), true);
});

test("the other fields are shown in both modes", () => {
  for (const mode of [true, false]) {
    assert.equal(syncFieldShown("repo", mode), true);
    assert.equal(syncFieldShown("branch", mode), true);
  }
});

test("key matching is exact, so a token-like key is still shown", () => {
  assert.equal(syncFieldShown("Token", true), true);
  assert.equal(syncFieldShown("tokens", true), true);
  assert.equal(syncFieldShown("", true), true);
});
