import assert from "node:assert/strict";
import test from "node:test";

/** The served build: no desktop shell, so nothing that needs one is listed. */
delete process.env.NEXT_PUBLIC_WEAVEFORGE_DESKTOP;

test("desktop-only modules are absent from the web build, and nothing links to them", async () => {
  const { buildModuleRegistry } = await import("../registry");
  const registry = buildModuleRegistry();
  const ids = registry.allModules.map((module) => module.id);
  assert.equal(ids.includes("editor-workspace"), false);
  const paths = registry.navGroups.flatMap((group) => group.items.map((item) => item.path));
  assert.equal(paths.includes("/workspace"), false);
});
