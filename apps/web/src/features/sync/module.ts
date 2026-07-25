import type { FeatureModule } from "@thesis/core";

/** Git tab — view the connected repo (commits/branches), track runs. */
export const gitModule: FeatureModule = {
  id: "git",
  title: "Git",
  navGroup: "experiments",
  navItems: [{ key: "git", label: "Git", path: "/git", icon: "git" }],
  routes: [{ path: "/git", component: "sync/GitPage" }],
};
