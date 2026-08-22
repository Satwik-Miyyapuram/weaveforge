import type { FeatureModule } from "@weaveforge/core";

/** Experiments (code/run tracker) feature module descriptor. */
export const experimentsModule: FeatureModule = {
  id: "experiments",
  title: "Experiments",
  navGroup: "experiments",
  // Runs are reported by the SDK to a server. Until that has a local
  // counterpart, the offline build has no experiments to list (plan D10).
  requiresNetwork: true,
  navItems: [{ key: "experiments", label: "Experiments", path: "/experiments", icon: "flask" }],
  routes: [{ path: "/experiments", component: "experiments/ExperimentsPage" }],
  migrations: ["0009_experiments.sql"],
};
