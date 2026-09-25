import type { FeatureModule } from "@weaveforge/core";

/**
 * The reading-lists feature module descriptor. Discovered via the registry; the
 * shell is never edited when modules are added (Open/Closed).
 *
 * A tab of its own, because a list is a thing you make, name, nest and delete —
 * not only a property you set on a paper. Filing *into* a list from the item is
 * the card menu's job; everything that manages the list itself lives on this
 * screen, which is why it is reachable again.
 */
export const readingListsModule: FeatureModule = {
  id: "reading-lists",
  title: "Lists",
  navGroup: "library",
  navItems: [{ key: "reading-lists", label: "Lists", path: "/lists", icon: "list" }],
  routes: [{ path: "/lists", component: "reading-lists/ListsPage" }],
  migrations: ["0004_reading_lists.sql", "0057_reading_lists_e2ee.sql", "0120_screening_decisions.sql"],
};
