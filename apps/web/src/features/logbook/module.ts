import type { FeatureModule } from "@thesis/core";

/**
 * The logbook feature module descriptor. The app shell discovers this via the
 * registry and contributes its nav entry + route automatically — the shell is
 * never edited when modules are added (Open/Closed).
 */
export const logbookModule: FeatureModule = {
  id: "logbook",
  title: "Log",
  navGroup: "plan",
  navItems: [{ key: "logbook", label: "Log", path: "/log", icon: "pencil" }],
  routes: [{ path: "/log", component: "logbook/LogbookPage" }],
  migrations: ["0002_log_entries.sql"],
};
