import type { FeatureModule } from "@weaveforge/core";

export const dashboardModule: FeatureModule = {
  id: "dashboard",
  title: "Dashboard",
  navItems: [{ key: "dashboard", label: "Home", path: "/dashboard", icon: "home" }],
  routes: [{ path: "/dashboard", component: "dashboard/DashboardPage" }],
  migrations: ["0021_project_dashboard_layout.sql"],
};
