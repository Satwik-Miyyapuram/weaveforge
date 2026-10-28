/**
 * The wiki is not yet good enough to be a destination of its own, so it left
 * the sidebar. It stays one click away from the ⋯ menus on Notes and Papers,
 * and on /wiki the sidebar lights Notes, so the reader is never on a screen
 * with nothing highlighted (DA-85).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { activeNavItem } from "@/registry";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

test("the sidebar and the phone have no Wiki item, but the route stays", async () => {
  const { buildModuleRegistry } = await import("../registry");
  const registry = buildModuleRegistry();
  const items = [...registry.navItems, ...registry.topNavItems, ...registry.navGroups.flatMap((group) => group.items)];
  assert.equal(items.some((item) => item.path === "/wiki"), false);
  const routes = registry.allModules.flatMap((module) => module.routes);
  assert.ok(routes.some((route) => route.path === "/wiki"), "/wiki still opens");
});

test("on /wiki the sidebar and the phone strip light Notes", async () => {
  const { buildModuleRegistry, groupForPath } = await import("../registry");
  const groups = buildModuleRegistry().navGroups;
  const library = groupForPath("/wiki", groups);
  assert.equal(activeNavItem(library?.items ?? [], "/wiki")?.path, "/notes");
  assert.equal(activeNavItem(library?.items ?? [], "/wiki/some-page")?.path, "/notes");
});

test("a path an item also lights is matched like its own, and only on a whole segment", () => {
  const items = [{ key: "notes", path: "/notes", alsoActiveOn: ["/wiki"] }];
  assert.equal(activeNavItem(items, "/wiki")?.key, "notes");
  assert.equal(activeNavItem(items, "/wikis"), undefined);
});

test("the wiki is still one click away from Notes and Papers", () => {
  assert.match(read("features/vault/ui/vault-screen/vault-screen.tsx"), /router\.push\("\/wiki"\)/);
  assert.match(read("features/papers/ui/papers-list.tsx"), /router\.push\("\/wiki"\)/);
});
