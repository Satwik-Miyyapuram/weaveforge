import assert from "node:assert/strict";
import { test } from "node:test";

import { DryRunZoteroAnnotationWriteBack } from "../zotero";

test("DryRunZoteroAnnotationWriteBack: live push throws before any core call", async () => {
  const dryRun = new DryRunZoteroAnnotationWriteBack();
  await assert.rejects(
    () => dryRun.push("ITEMKEY1", [], { live: true }),
    /Live Zotero write-back is disabled/,
  );
});
