import type { FeatureModule } from "@weaveforge/core";

/** Git tab — view the connected repo (commits/branches), track runs. */
export const gitModule: FeatureModule = {
  id: "git",
  title: "Git",
  // Library, for the same reason Experiments moved there: the `experiments`
  // group had exactly these two members and both belong with the reader's
  // other work. It is the last thing that kept a group alive on one item.
  navGroup: "library",
  navItems: [{ key: "git", label: "Git", path: "/git", icon: "git" }],
  routes: [{ path: "/git", component: "sync/GitPage" }],
};
