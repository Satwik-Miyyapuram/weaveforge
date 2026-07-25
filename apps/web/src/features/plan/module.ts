import type { FeatureModule } from "@thesis/core";

/** Plan (forward-looking milestones) feature module descriptor. */
export const planModule: FeatureModule = {
  id: "plan",
  title: "Plan",
  navGroup: "plan",
  navItems: [{ key: "plan", label: "Plan", path: "/plan", icon: "flag" }],
  routes: [{ path: "/plan", component: "plan/PlanPage" }],
  migrations: ["0011_milestones.sql"],
};
