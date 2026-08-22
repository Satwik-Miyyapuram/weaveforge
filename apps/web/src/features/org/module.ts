import type { FeatureModule } from "@weaveforge/core";

/** Supervisor view — header route for PhD+ roles. /org redirects to Settings. */
export const orgModule: FeatureModule = {
  id: "org",
  title: "Supervision",
  shell: true,
  // Other people's accounts, over the network, always (plan D3).
  requiresNetwork: true,
  navItems: [],
  routes: [
    { path: "/supervision", component: "org/SupervisionPage" },
    { path: "/org", component: "org/OrgRedirectPage" },
  ],
};
