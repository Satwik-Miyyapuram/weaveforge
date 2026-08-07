import type { FeatureModule } from "@weaveforge/core";

/** Settings — header route (People/Org, integrations, Zotero). */
export const settingsModule: FeatureModule = {
  id: "settings",
  title: "Settings",
  shell: true,
  navItems: [],
  routes: [{ path: "/settings", component: "settings/SettingsPage" }],
  migrations: ["0054_user_settings_appearance.sql", "0055_user_settings_disclaimer_version.sql", "0068_user_settings_ai_access.sql"],
};
