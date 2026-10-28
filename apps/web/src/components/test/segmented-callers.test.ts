/**
 * A row of mutually exclusive text choices is the shared SegmentedControl, not a
 * hand-made group with its own button CSS (D02). The sync merge's Mine / Cloud /
 * Both / Edit, its per-change pick, and the shared-with-me type filter were each
 * drawn by hand and looked different from every other toggle row.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

test("the sync merge picks are SegmentedControls", () => {
  const src = read("features/offline-sync/ui/sync-issues-panel.tsx");
  assert.equal(src.match(/<SegmentedControl\b/g)?.length, 2);
  assert.doesNotMatch(src, /className="sync-seg"/);
  assert.doesNotMatch(src, /<ToggleButton\b/);
});

test("the shared-with-me type filter is a SegmentedControl", () => {
  const src = read("features/sharing/ui/shared-with-me-screen.tsx");
  assert.match(src, /<SegmentedControl\b/);
  assert.doesNotMatch(src, /<ToggleButton\b/);
});

test("no stylesheet draws those groups' buttons by hand", () => {
  for (const f of ["settings.css", "overlays.css", "brutal.css"]) {
    const css = read(`app/styles/${f}`);
    assert.doesNotMatch(css, /\.sync-seg\b/, f);
    assert.doesNotMatch(css, /\.sync-hunk-pick > button/, f);
    assert.doesNotMatch(css, /\.shared-filter\b/, f);
  }
});
