/**
 * Applying an import with no folder connected (B65, 29-03).
 *
 * The ZIP button reaches `applyFolderImport` too; with no folder it used to
 * answer "0 created, 0 updated" as if the import had worked.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { applyFolderImport } from "../application/folder-import-apply";
import { activeWorkspaceFs } from "../application/workspace-folder";

test("an import with no folder connected says why instead of reporting nothing", async () => {
  assert.equal(activeWorkspaceFs(), null);
  await assert.rejects(
    applyFolderImport({ entries: [] } as never),
    /no workspace folder/i,
  );
});
