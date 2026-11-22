/**
 * A no-account copy cannot restore tables from the folder. The import throws in
 * liveImportSeams, and the Apply button in workspace-folder-panel shows the
 * formatted message. This asserts that the text the user sees carries the reason.
 */
import assert from "node:assert/strict";
import { test, before, after } from "node:test";

import type { FolderImportDiff, FolderImportPicks } from "../application/workspace-folder-tables";
import { applyReviewedImport } from "../application/workspace-folder";
import { loadTestCore } from "@/lib/test/load-test-core";
import { formatError } from "@/lib/format-error";
import { setLocalMode } from "@/features/auth/infrastructure/no-account-mode";

const host = globalThis as { localStorage?: Storage };
const previous = host.localStorage;
const data = new Map<string, string>();
const memory = {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => void data.set(k, String(v)),
  removeItem: (k: string) => void data.delete(k),
  clear: () => data.clear(),
  key: () => null,
  get length() {
    return data.size;
  },
} as unknown as Storage;

const REASON =
  "Restoring tables from the folder needs an account. A no-account copy keeps its data in the folder.";

before(async () => {
  host.localStorage = memory;
  await loadTestCore();
});

after(() => {
  host.localStorage = previous;
});

test("a no-account Apply that restores tables shows the reason to the user", async () => {
  data.clear();
  setLocalMode(true);
  const diff = {} as FolderImportDiff;
  const picks = {} as FolderImportPicks;

  await assert.rejects(applyReviewedImport(diff, picks), (err: unknown) => {
    assert.equal(err instanceof Error ? err.message : String(err), REASON);
    assert.ok(formatError(err).includes(REASON), "the panel's error text carries the reason");
    return true;
  });
});
