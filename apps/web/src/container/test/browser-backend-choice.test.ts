import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseFileBackend } from "../file-backend-choice";

/** Spy wirings: each records how often it was built, so the test shows which path ran. */
function spies() {
  const calls = { files: 0, postgrest: 0 };
  return {
    calls,
    files: () => { calls.files += 1; return "files" as const; },
    postgrest: () => { calls.postgrest += 1; return "postgrest" as const; },
  };
}

test("no desktop bridge, migration verified: the file backend is chosen and PostgREST is not built", () => {
  const s = spies();
  assert.equal(chooseFileBackend("verified", s.files, s.postgrest), "files");
  assert.deepEqual(s.calls, { files: 1, postgrest: 0 });
});

test("no desktop bridge, migration not verified: PostgREST stays on with writes on", () => {
  for (const state of ["incomplete", "none", "unavailable", undefined] as const) {
    const s = spies();
    assert.equal(chooseFileBackend(state, s.files, s.postgrest), "postgrest", String(state));
    assert.deepEqual(s.calls, { files: 0, postgrest: 1 }, String(state));
  }
});
