import type { FeatureModule } from "@thesis/core";

/**
 * The reading-lists feature module descriptor. Discovered via the registry; the
 * shell is never edited when modules are added (Open/Closed).
 */
export const readingListsModule: FeatureModule = {
  id: "reading-lists",
  title: "Lists",
  navGroup: "library",
  navItems: [{ key: "reading-lists", label: "Lists", path: "/lists", icon: "list" }],
  routes: [{ path: "/lists", component: "reading-lists/ListsPage" }],
  migrations: ["0004_reading_lists.sql", "0057_reading_lists_e2ee.sql"],
};
