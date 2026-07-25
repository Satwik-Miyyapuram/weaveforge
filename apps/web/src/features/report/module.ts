import type { FeatureModule } from "@thesis/core";

/**
 * The report feature module descriptor. Discovered via the registry; the shell
 * is never edited when modules are added (Open/Closed).
 */
export const reportModule: FeatureModule = {
  id: "report",
  title: "Report",
  navGroup: "report",
  navItems: [
    { key: "report-sections", label: "Sections", path: "/report", icon: "doc" },
    { key: "report-overleaf", label: "Overleaf", path: "/report/overleaf", icon: "doc" },
  ],
  routes: [
    { path: "/report", component: "report/ReportPage" },
    { path: "/report/overleaf", component: "report/ReportOverleafPage" },
  ],
  migrations: ["0003_report_sections.sql"],
};
