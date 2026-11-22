import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseBrowserBackend, opfsVerified } from "../browser-backend-098";

test("verified report with target opfs selects the OPFS file backend", () => {
  assert.equal(chooseBrowserBackend({ state: "verified", target: "opfs" }), "files");
  assert.equal(opfsVerified({ state: "verified", target: "opfs" }), true);
});

test("a zip-only or folder export never selects files: the user is sent to export first", () => {
  assert.equal(chooseBrowserBackend({ state: "verified", target: "folder" }), "export-first");
  assert.equal(opfsVerified({ state: "verified", target: "folder" }), false);
});

test("a verified report without a target never selects files", () => {
  assert.equal(chooseBrowserBackend({ state: "verified" }), "export-first");
});

test("any state other than verified shows export-first, even with target opfs", () => {
  for (const state of ["incomplete", "none", "unavailable", "running"]) {
    assert.equal(chooseBrowserBackend({ state, target: "opfs" }), "export-first", state);
  }
});

test("missing or malformed reports show export-first", () => {
  for (const report of [undefined, null, "verified", 42, {}]) {
    assert.equal(chooseBrowserBackend(report), "export-first", JSON.stringify(report));
  }
});
