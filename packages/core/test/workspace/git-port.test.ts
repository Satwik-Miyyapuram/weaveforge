import assert from "node:assert/strict";
import { test } from "node:test";

import { isLocalOnlyPath, keptOutOfHistory, MAX_COMMIT_FILE_BYTES } from "../../src/workspace/git-port.js";

test("only the root .weaveforge folder is local-only, in either slash style", () => {
  for (const p of [".weaveforge", ".weaveforge/db/base/5/18522", "/.weaveforge/db.lock", ".weaveforge\\db\\pg_wal\\0001"]) {
    assert.equal(isLocalOnlyPath(p), true, p);
  }
  // A project's own .weaveforge holds its manifest and tags: that is history.
  for (const p of ["project--6052c0/.weaveforge/manifest.json", ".weaveforge-notes/a.md", "notes/.weaveforge", "a.note.md"]) {
    assert.equal(isLocalOnlyPath(p), false, p);
  }
});

test("the size cap is 50 MiB, under the 100 MB a git host refuses", () => {
  assert.equal(MAX_COMMIT_FILE_BYTES, 50 * 1024 * 1024);
});

test("a file is kept out of history when it is local-only or over the cap, and a file exactly at the cap is not", () => {
  assert.equal(keptOutOfHistory(".weaveforge/db/base/1", 10), "local-only");
  assert.equal(keptOutOfHistory("papers/big.pdf", MAX_COMMIT_FILE_BYTES + 1), "too-large");
  assert.equal(keptOutOfHistory("papers/ok.pdf", MAX_COMMIT_FILE_BYTES), null);
  assert.equal(keptOutOfHistory("a.note.md", 0), null);
  // Size unknown (a deleted file has none): never a reason to keep the change out.
  assert.equal(keptOutOfHistory("gone.pdf", null), null);
  assert.equal(keptOutOfHistory("papers/big.pdf", 2_000, 1_000), "too-large");
});
