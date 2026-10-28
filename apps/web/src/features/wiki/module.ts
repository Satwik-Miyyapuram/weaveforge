import type { FeatureModule } from "@weaveforge/core";

/**
 * The wiki is in Library after Notes: its pages are things you have, and a
 * route with no nav item left the reader with no active item there (DA-85).
 */
export const wikiModule: FeatureModule = {
  id: "wiki",
  title: "Wiki",
  navGroup: "library",
  navItems: [{ key: "wiki", label: "Wiki", path: "/wiki", icon: "wiki" }],
  routes: [{ path: "/wiki", component: "wiki/WikiScreen" }],
};
