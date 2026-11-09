import assert from "node:assert/strict";
import { test } from "node:test";

import { DryRunZoteroAnnotationWriteBack } from "../dry-run-zotero-write-back";

test("DryRunZoteroAnnotationWriteBack: live push throws before any core call", async () => {
  const dryRun = new DryRunZoteroAnnotationWriteBack();
  await assert.rejects(
    () => dryRun.push("ITEMKEY1", [], { live: true }),
    /Live Zotero write-back is disabled/,
  );
});
