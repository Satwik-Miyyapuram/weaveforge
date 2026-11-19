import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// M1: a sync records its digests only if no database replace happened while it ran. The generation
// it compares against must be read before the first await, or a replace during the early awaits
// (the rename check, the snapshot) goes unseen and the stale run records digests afterwards.

const source = readFileSync(new URL("../application/workspace-folder.ts", import.meta.url), "utf8");

test("runSyncToFolder reads the session generation before its first await", () => {
  const start = source.indexOf("async function runSyncToFolder(");
  assert.ok(start >= 0, "runSyncToFolder is defined in workspace-folder.ts");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  const capture = body.indexOf("const startedAt = sessionGeneration();");
  const firstAwait = body.indexOf("await ");
  assert.ok(capture >= 0, "runSyncToFolder captures startedAt from sessionGeneration()");
  assert.ok(firstAwait >= 0 && capture < firstAwait, "the capture comes before the first await");
});
