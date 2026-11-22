import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseFileBackend } from "../file-backend-choice";

const choices = {
  files: () => "files" as const,
  old: () => "postgrest-writes-on" as const,
  readOnly: () => "readonly-old-db" as const,
};

test("a verified migration with a file wiring selects files, on web and desktop", () => {
  assert.equal(chooseFileBackend("verified", choices, false), "files");
  assert.equal(chooseFileBackend("verified", choices, true), "files");
});

test("verified with no file wiring falls back, and desktop fails closed to read-only", () => {
  const noFiles = { old: choices.old, readOnly: choices.readOnly };
  assert.equal(chooseFileBackend("verified", noFiles, false), "postgrest-writes-on");
  assert.equal(chooseFileBackend("verified", noFiles, true), "readonly-old-db");
});

test("web and Android keep PostgREST with writes on for every non-verified state", () => {
  for (const state of ["none", "incomplete", "unavailable", undefined] as const) {
    assert.equal(chooseFileBackend(state, choices, false), "postgrest-writes-on", `web, ${String(state)}`);
  }
});

test("desktop: a genuine none keeps writes on", () => {
  assert.equal(chooseFileBackend("none", choices, true), "postgrest-writes-on");
});

test("desktop: incomplete, unavailable or unknown fail closed to read-only, never writes-on", () => {
  for (const state of ["incomplete", "unavailable", undefined] as const) {
    assert.equal(chooseFileBackend(state, choices, true), "readonly-old-db", `desktop, ${String(state)}`);
  }
});

test("desktop: a folder removed by another device, unexported here, fails closed to read-only and never wires files", () => {
  assert.equal(chooseFileBackend("unexported", choices, true), "readonly-old-db");
  assert.equal(chooseFileBackend("removing-other", choices, true), "readonly-old-db");
});
