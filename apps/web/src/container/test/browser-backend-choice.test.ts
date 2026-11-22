import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseFileBackend, type BackendChoices } from "../file-backend-choice";

/** Spy wirings: each records how often it was built, so the test shows which path ran. */
function spies() {
  const calls = { files: 0, old: 0, readOnly: 0 };
  const choices: BackendChoices<string> = {
    files: () => {
      calls.files += 1;
      return "files";
    },
    old: () => {
      calls.old += 1;
      return "old";
    },
    readOnly: () => {
      calls.readOnly += 1;
      return "readOnly";
    },
  };
  return { calls, choices };
}

test("browser with the file wiring and a verified migration: the file backend is chosen and PostgREST is not built", () => {
  const s = spies();
  assert.equal(chooseFileBackend("verified", s.choices, false), "files");
  assert.deepEqual(s.calls, { files: 1, old: 0, readOnly: 0 });
});

test("browser, migration not verified: PostgREST stays on with writes on", () => {
  for (const state of ["incomplete", "none", "unavailable", undefined] as const) {
    const s = spies();
    assert.equal(chooseFileBackend(state, s.choices, false), "old", String(state));
    assert.deepEqual(s.calls, { files: 0, old: 1, readOnly: 0 }, String(state));
  }
});

test("browser with no file wiring injected: PostgREST stays on even when verified", () => {
  const s = spies();
  const withoutFiles: BackendChoices<string> = { old: s.choices.old, readOnly: s.choices.readOnly };
  assert.equal(chooseFileBackend("verified", withoutFiles, false), "old");
  assert.deepEqual(s.calls, { files: 0, old: 1, readOnly: 0 });
});
