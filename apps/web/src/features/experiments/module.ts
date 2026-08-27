import type { FeatureModule } from "@weaveforge/core";

/** Experiments (code/run tracker) feature module descriptor. */
export const experimentsModule: FeatureModule = {
  id: "experiments",
  title: "Experiments",
  navGroup: "experiments",
  // The SDK reported runs to a server, and for a while that made this the one
  // feature a copy with no account could not have. It now writes into the local
  // database over the loopback API (`local-sdk-api.ts`), so the offline build
  // has experiments to list — what it does not have is a page per experiment,
  // which `experiment-href.ts` handles.
  requiresNetwork: false,
  navItems: [{ key: "experiments", label: "Experiments", path: "/experiments", icon: "flask" }],
  routes: [{ path: "/experiments", component: "experiments/ExperimentsPage" }],
  migrations: ["0009_experiments.sql"],
};
