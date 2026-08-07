import type { FeatureModule } from "@weaveforge/core";

/**
 * The papers feature module descriptor. The app shell discovers this via the
 * registry and contributes its nav entry + route automatically — the shell is
 * never edited when modules are added (Open/Closed).
 */
export const papersModule: FeatureModule = {
  id: "papers",
  title: "Papers",
  navGroup: "library",
  navItems: [{ key: "papers", label: "Papers", path: "/papers", icon: "book" }],
  routes: [{ path: "/papers", component: "papers/PapersPage" }],
  migrations: ["0001_papers.sql"],
};
