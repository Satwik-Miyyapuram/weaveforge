import type { FeatureModule } from "@weaveforge/core";

/**
 * The wiki has no sidebar item until it is good enough to be a destination;
 * it opens from the ⋯ menus on Notes and Papers, and Notes lights on /wiki
 * so the reader still has an active item there (DA-85).
 */
export const wikiModule: FeatureModule = {
  id: "wiki",
  title: "Wiki",
  navItems: [],
  routes: [{ path: "/wiki", component: "wiki/WikiScreen" }],
};
