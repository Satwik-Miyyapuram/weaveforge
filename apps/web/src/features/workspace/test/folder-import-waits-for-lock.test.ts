import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The folder import forgets the in-session record, then runs a mirror. A mirror still in
// flight from before the import must finish first, or it could record digests into the
// record after it was cleared. The import must wait for the folder lock to go idle first.

const source = readFileSync(new URL("../application/parts-1.ts", import.meta.url), "utf8");

test("applyFolderImport waits for the folder lock to go idle before it forgets the session record", () => {
  const start = source.indexOf("export async function applyFolderImport(");
  assert.ok(start >= 0, "applyFolderImport is defined in parts-1.ts");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  const idle = body.indexOf("await folderLock.idle();");
  const forget = body.indexOf("forgetSessionSeen();");
  assert.ok(idle >= 0, "applyFolderImport awaits folderLock.idle()");
  assert.ok(forget > idle, "the wait comes before forgetSessionSeen()");
});
