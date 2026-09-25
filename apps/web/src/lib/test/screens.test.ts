import assert from "node:assert/strict";
import test from "node:test";

import { SCREEN_IDS } from "@/lib/screens";
import { screenForPath } from "@/lib/screen-for-path";
import { WRITE_INVALIDATION_MAP } from "@/lib/cache/cache-invalidation-map";

/**
 * The screen vocabulary, kept in one place and checked in the direction the
 * types cannot check.
 *
 * Typing the lists as `ScreenId` makes a *wrong* name a compile error. It cannot
 * notice a screen that was added to the registry and never mentioned in the
 * invalidation map — that is a screen whose cache survives every write, with no
 * error anywhere — so that is what these assert.
 */

test("every screen is named somewhere in the invalidation map", () => {
  const named = new Set(
    Object.values(WRITE_INVALIDATION_MAP).flatMap((entry) => entry.screens),
  );

  assert.deepEqual(
    SCREEN_IDS.filter((id) => !named.has(id)),
    [],
    "a new screen wants an entry, even if only to record that nothing invalidates it",
  );
});

test("the invalidation map names no screen that does not exist", () => {
  // Belt and braces beside the type: this catches the case where the map was
  // widened back to `string[]` and a stale name with it.
  const known = new Set<string>(SCREEN_IDS);
  const unknown = [
    ...new Set(Object.values(WRITE_INVALIDATION_MAP).flatMap((entry) => entry.screens)),
  ].filter((id) => !known.has(id));

  assert.deepEqual(unknown, []);
});

test("a list route resolves to its screen, and its detail routes to nothing", () => {
  assert.equal(screenForPath("/papers"), "papers");
  assert.equal(screenForPath("/notes"), "vault");
  assert.equal(screenForPath("/log"), "logbook");
  assert.equal(screenForPath("/experiments"), "experiments");

  // A detail route is not the list: caching one run's page under the list's key
  // would paint the list instead.
  assert.equal(screenForPath("/experiments/abc"), null);
  assert.equal(screenForPath("/papers/abc"), null);
});

test("a query string or fragment does not change which screen a path is", () => {
  assert.equal(screenForPath("/papers?tag=rl"), "papers");
  assert.equal(screenForPath("/papers#top"), "papers");
  assert.equal(screenForPath("/papers?tag=rl#top"), "papers");
});

test("the Overleaf tab resolves to its own screen, not to the report list", () => {
  // `/report/overleaf` has a cache key of its own and was in no list at all: the
  // tab hovered warmed nothing and the nav overlay covered a screen that already
  // had data. The `/report` prefix below it in the table does not swallow it,
  // because the exact lookup runs first.
  assert.equal(screenForPath("/report"), "report");
  assert.equal(screenForPath("/report/overleaf"), "report-overleaf");
  assert.equal(screenForPath("/report/overleaf?tab=export"), "report-overleaf");
});

test("an unknown path is not a screen", () => {
  assert.equal(screenForPath("/settings"), null);
  assert.equal(screenForPath("/"), null);
  assert.equal(screenForPath("/papersfoo"), null);
});
