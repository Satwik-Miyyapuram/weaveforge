import assert from "node:assert/strict";
import test from "node:test";

import { spawnFailureDetail } from "../search.mjs";

test("a spawn error wins over stderr", () => {
  assert.equal(spawnFailureDetail({ error: new Error("ENOENT"), stderr: "x", status: null }), "ENOENT");
});

test("stderr is trimmed and used when there is no spawn error", () => {
  assert.equal(spawnFailureDetail({ stderr: "  fatal: not a git repository\n", status: 128 }), "fatal: not a git repository");
});

test("empty or missing stderr falls back to the exit code", () => {
  assert.equal(spawnFailureDetail({ stderr: "  \n", status: 128 }), "exit 128");
  assert.equal(spawnFailureDetail({ stderr: null, status: 1 }), "exit 1");
});
