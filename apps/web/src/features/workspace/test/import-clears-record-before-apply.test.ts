import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// M2: the folder import must wait for a running mirror and clear the in-session record before it
// applies anything. Otherwise a mirror started during the apply could record digests that the
// import then leaves behind, and the next mirror would hold the imported files as outside edits.

const source = readFileSync(new URL("../application/parts-1.ts", import.meta.url), "utf8");

test("applyFolderImport waits for the lock and clears the session record before applying entries", () => {
  const start = source.indexOf("export async function applyFolderImport(");
  assert.ok(start >= 0, "applyFolderImport is defined in parts-1.ts");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  const apply = body.indexOf("await applyEntries(");
  const idle = body.indexOf("await folderLock.idle();");
  const forget = body.indexOf("forgetSessionSeen();");
  assert.ok(apply >= 0, "applyFolderImport calls applyEntries");
  assert.ok(idle >= 0 && idle < apply, "folderLock.idle() is awaited before applyEntries");
  assert.ok(forget > idle && forget < apply, "forgetSessionSeen() runs after the idle wait and before applyEntries");
});
