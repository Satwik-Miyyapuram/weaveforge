/**
 * The screens where a choice can lose work spoke sync jargon ("Refused
 * writes", "refused as out of date", "Write conflict markers") and named the
 * same choice four ways: Keep all mine / Take all cloud, All mine / All cloud,
 * Restore cloud copy / Keep deleted, Ours / Theirs (design D21, DA-134). Each
 * side now has one name.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");
const panel = read("features/offline-sync/ui/sync-issues-panel.tsx");
const folder = read("features/settings/ui/folder-conflict-card.tsx");

test("sync choices use one pair: this device's or the cloud's", () => {
  for (const old of ["Keep all mine", "Take all cloud", "All mine", "All cloud", "Restore cloud copy", "Keep deleted", "Keep mine", "Delete it"]) {
    assert.ok(!panel.includes(`>${old}<`) && !panel.includes(`"${old}"`), `"${old}" is gone`);
  }
  assert.match(panel, /Keep this device&apos;s/);
  assert.match(panel, /Keep the cloud&apos;s/);
});

test("nothing on the sync screen says refused", () => {
  assert.doesNotMatch(panel, /[Rr]efused/, "the reader sees what happened, not the server's verb");
  assert.match(panel, /Changes that could not be saved/);
});

test("the folder conflict names its sides the same way everywhere", () => {
  for (const old of ['"Ours"', '"Theirs"', "Write conflict markers", "Take the folder&apos;s copy", "Keep this app&apos;s copy"]) {
    assert.ok(!folder.includes(old), `${old} is gone`);
  }
  assert.match(folder, /Keep this app&apos;s/);
  assert.match(folder, /Keep the folder&apos;s/);
  assert.match(folder, /Mark both in the file/);
});
