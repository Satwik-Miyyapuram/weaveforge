import assert from "node:assert/strict";
import test from "node:test";

/**
 * A group heading is only a heading if something is under it.
 *
 * The bug this pins: both members of the `experiments` group were moved out of
 * it — Experiments to Library and Git with the rest of the shell's tools — but
 * the key stayed in `NAV_GROUP_ORDER`, so `buildNavGroupsFromModules` built a
 * group whose item list was empty and the sidebar drew an "Experiments" fold
 * that opened onto nothing. The user's own words for it were that a separate
 * "Experiments" heading still rendered.
 *
 * One environment only, and not two: this file must not flip
 * `NEXT_PUBLIC_WEAVEFORGE_DESKTOP`, which the modules it imports read at import
 * time and which node:test shares across the files in a run.
 */
test("no nav group is emitted without items", async () => {
  const { buildModuleRegistry } = await import("../registry");
  const registry = buildModuleRegistry();
  for (const group of registry.navGroups) {
    assert.ok(group.items.length > 0, `a "${group.label}" group with no items was emitted`);
  }
});

/**
 * And the two features that moved are still reachable.
 *
 * Home is deliberately not in a group: it is `homeNavItem`, rendered above them
 * by the shell, so it is excluded here rather than leaving the two sets
 * permanently different. Every *other* module's item must appear exactly once —
 * a group filtered for having no items must not have taken an item with it.
 *
 * The two names below are asserted only when their modules are enabled, because
 * `git` is dropped when `gitRead` is empty (`registry.ts`'s `moduleEnabled`) —
 * a supported configuration, and one a bare `includes("git")` would fail on.
 * The set comparison above is the real assertion; this is the sanity check that
 * moving the items did not silently delete them.
 */
test("every module with a nav item is listed in exactly one group", async () => {
  const { buildModuleRegistry } = await import("../registry");
  const registry = buildModuleRegistry();
  const listed = registry.navGroups.flatMap((group) => group.items.map((item) => item.key));
  const declared = registry.modules
    .flatMap((module) => module.navItems.map((item) => item.key))
    .filter((key) => key !== registry.homeNavItem.key);
  assert.deepEqual(
    [...listed].sort(),
    [...declared].sort(),
    "a nav item was dropped, or listed twice",
  );
  const enabled = new Set(registry.modules.map((module) => module.id));
  for (const key of ["git", "experiments"]) {
    if (enabled.has(key)) assert.equal(listed.includes(key), true, `${key} is enabled but unlisted`);
  }
});
