import type { FeatureModule } from "@weaveforge/core";

export const wikiModule: FeatureModule = {
  id: "wiki",
  title: "Wiki",
  navGroup: "library",
  navItems: [{ key: "wiki", label: "Wiki", path: "/wiki", icon: "notes" }],
  routes: [{ path: "/wiki", component: "wiki/WikiScreen" }],
};
