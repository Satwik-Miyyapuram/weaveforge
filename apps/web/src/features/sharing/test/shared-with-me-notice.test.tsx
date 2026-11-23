/**
 * Shared with me, when some types could not load: the banner must not promise
 * items below when none are shown, and the first-run "nothing shared yet" card
 * must not appear, since things may well be shared but failed to load.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { sharedWithMeNotice } from "@/features/sharing/ui/shared-with-me-screen";

test("nothing unavailable: no banner; the first-run card shows only when nothing is shown", () => {
  assert.deepEqual(sharedWithMeNotice([], 0), { banner: null, firstRunEmpty: true });
  assert.deepEqual(sharedWithMeNotice([], 2), { banner: null, firstRunEmpty: false });
});

test("some types unavailable and others shown: the banner points at the rest below", () => {
  assert.deepEqual(sharedWithMeNotice(["paper"], 1), {
    banner: "Could not load shared papers. The rest is below.",
    firstRunEmpty: false,
  });
});

test("some types unavailable and nothing shown: no first-run card, and no 'rest is below'", () => {
  assert.deepEqual(sharedWithMeNotice(["paper", "vault_page"], 0), {
    banner: "Could not load shared papers, notes. Nothing else could be shown.",
    firstRunEmpty: false,
  });
});
