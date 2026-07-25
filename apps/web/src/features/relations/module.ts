import type { FeatureModule } from "@thesis/core";

/**
 * The graph (paper relations) feature module descriptor. Discovered via the
 * registry; the shell is never edited when modules are added (Open/Closed).
 */
export const graphModule: FeatureModule = {
  id: "graph",
  title: "Graph",
  navGroup: "library",
  navItems: [{ key: "graph", label: "Graph", path: "/graph", icon: "graph" }],
  routes: [{ path: "/graph", component: "relations/GraphPage" }],
  migrations: ["0005_paper_relations.sql", "0053_project_graph_settings.sql"],
};
