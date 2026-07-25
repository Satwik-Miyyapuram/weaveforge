import type { FeatureModule } from "@thesis/core";

/** Experiments (code/run tracker) feature module descriptor. */
export const experimentsModule: FeatureModule = {
  id: "experiments",
  title: "Experiments",
  navGroup: "experiments",
  navItems: [{ key: "experiments", label: "Experiments", path: "/experiments", icon: "flask" }],
  routes: [{ path: "/experiments", component: "experiments/ExperimentsPage" }],
  migrations: ["0009_experiments.sql"],
};
