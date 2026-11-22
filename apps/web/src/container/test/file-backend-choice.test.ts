import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseFileBackend } from "../file-backend-choice";

const files = () => "files" as const;
const old = () => "postgrest" as const;

test("a verified migration wires the file backend", () => {
  assert.equal(chooseFileBackend("verified", files, old), "files");
});

test("any state other than verified keeps the old backend with writes on", () => {
  assert.equal(chooseFileBackend("incomplete", files, old), "postgrest");
  assert.equal(chooseFileBackend("none", files, old), "postgrest");
  assert.equal(chooseFileBackend("unavailable", files, old), "postgrest");
});

test("no migration state keeps the old backend", () => {
  assert.equal(chooseFileBackend(undefined, files, old), "postgrest");
});

test("without an injected file wiring the old backend is used even when verified", () => {
  assert.equal(chooseFileBackend("verified", undefined, old), "postgrest");
});
