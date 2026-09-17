import assert from "node:assert/strict";
import test from "node:test";

/** The served build: no desktop shell, so nothing that needs one is listed. */
delete process.env.NEXT_PUBLIC_WEAVEFORGE_DESKTOP;

test("the editor workspace is in the web build, and the nav reaches it", async () => {
  const { buildModuleRegistry } = await import("../registry");
  const registry = buildModuleRegistry();
  const ids = registry.allModules.map((module) => module.id);
  assert.equal(ids.includes("editor-workspace"), true);
  const paths = registry.navGroups.flatMap((group) => group.items.map((item) => item.path));
  assert.equal(paths.includes("/workspace"), true);
});
