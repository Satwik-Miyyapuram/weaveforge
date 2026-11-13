import assert from "node:assert/strict";
import { test } from "node:test";

import { rust } from "../../src/shared/rust.js";

// The verdict is decided in Rust (wf-core git_gate.rs); the tests run against the real core.
test("nothing is committed while the setting is off", () => {
  for (const state of [{ kind: "own" }, { kind: "none" }] as const) {
    assert.deepEqual(rust().decideVaultCommit(false, state), { ok: false, reason: "Folder history is switched off." });
  }
});

test("a folder that is its own repository is committed to", () => {
  assert.deepEqual(rust().decideVaultCommit(true, { kind: "own" }), { ok: true, action: "commit" });
});

test("a folder with no repository gets one", () => {
  assert.deepEqual(rust().decideVaultCommit(true, { kind: "none" }), { ok: true, action: "init" });
});

test("a folder inside someone else's repository is refused, and says whose", () => {
  const verdict = rust().decideVaultCommit(true, { kind: "enclosing", root: "/home/me/thesis" });
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok ? "" : verdict.reason, /\/home\/me\/thesis/);
});
