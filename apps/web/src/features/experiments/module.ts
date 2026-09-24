import type { FeatureModule } from "@weaveforge/core";

/** Experiments (code/run tracker) feature module descriptor. */
export const experimentsModule: FeatureModule = {
  id: "experiments",
  title: "Experiments",
  // Library, not a group of its own. The question this answers is where a reader
  // looks for experiments, and the answer is the same place as the rest of their
  // work — beside Papers, Notes and the Graph. A one-item heading of its own made
  // the sidebar read as two products, and the reader's own words for it were that
  // a separate "Experiments" heading still rendered after the nav item had moved.
  navGroup: "library",
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
