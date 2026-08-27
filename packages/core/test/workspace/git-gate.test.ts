import assert from "node:assert/strict";
import { test } from "node:test";

import { decideVaultCommit, GIT_OFF } from "../../src/workspace/git-gate.js";

test("nothing is committed while the setting is off", () => {
  for (const state of [{ kind: "own" }, { kind: "none" }] as const) {
    assert.deepEqual(decideVaultCommit(false, state), { ok: false, reason: GIT_OFF });
  }
});

test("a folder that is its own repository is committed to", () => {
  assert.deepEqual(decideVaultCommit(true, { kind: "own" }), { ok: true, action: "commit" });
});

test("a folder with no repository gets one", () => {
  assert.deepEqual(decideVaultCommit(true, { kind: "none" }), { ok: true, action: "init" });
});

test("a folder inside someone else's repository is refused, and says whose", () => {
  const verdict = decideVaultCommit(true, { kind: "enclosing", root: "/home/me/thesis" });
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok ? "" : verdict.reason, /\/home\/me\/thesis/);
});
