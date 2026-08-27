import assert from "node:assert/strict";
import test from "node:test";

/**
 * What the offline build leaves out.
 *
 * The flag is read once, when `build-target.ts` is first evaluated, so it is
 * set before the registry is imported rather than swapped between tests — and
 * the import is dynamic for the same reason, inside the tests because the
 * suite is transformed to CommonJS and a top-level await is not available
 * there. Each test file is its own process, so setting it here does not reach
 * the rest of the suite.
 */
process.env.NEXT_PUBLIC_WEAVEFORGE_DESKTOP = "1";

async function offlineRegistry() {
  const { buildModuleRegistry } = await import("../registry");
  return buildModuleRegistry();
}

test("modules that need a server are absent, not disabled", async () => {
  const ids = (await offlineRegistry()).allModules.map((module) => module.id);
  for (const id of ["sharing", "org"]) {
    assert.equal(ids.includes(id), false, `${id} should not be in an offline build`);
  }
});

test("the app itself is all still there", async () => {
  const ids = (await offlineRegistry()).allModules.map((module) => module.id);
  // `experiments` among them: the SDK writes into the local database now, so a
  // copy with no account has runs of its own to show.
  for (const id of ["dashboard", "papers", "vault", "wiki", "logbook", "settings", "experiments"]) {
    assert.equal(ids.includes(id), true, `${id} should survive an offline build`);
  }
});

test("nothing links to a screen the build does not contain", async () => {
  const registry = await offlineRegistry();
  const paths = [
    ...registry.navItems.map((item) => item.path),
    ...registry.navGroups.flatMap((group) => group.items.map((item) => item.path)),
  ];
  for (const path of paths) {
    assert.equal(path.startsWith("/shared"), false);
    assert.equal(path.startsWith("/supervision"), false);
  }
});
