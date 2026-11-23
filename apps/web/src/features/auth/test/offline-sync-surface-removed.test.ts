import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 0.9.8 has no offline sync UI: no sync loop, no sync header or settings panels, no offline entry. */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("the root layout does not mount the sync loop", () => {
  const src = read("../../../app/layout.tsx");
  assert.doesNotMatch(src, /SyncLoop|sync-loop/);
});

test("the header does not read live sync state", () => {
  const src = read("../../../app/header-actions.tsx");
  assert.doesNotMatch(src, /useLiveSync|syncStatus|offline-sync/);
});

test("settings does not show the sync panels", () => {
  const src = read("../../settings/ui/settings-screen.tsx");
  assert.doesNotMatch(src, /SyncSettingsPanel|SyncIssuesPanel|offline-sync/);
});

test("the privacy gate has no offline entry button", () => {
  const src = read("../ui/privacy-disclaimer-gate.tsx");
  assert.doesNotMatch(src, /Work on this computer/);
});
