import type { FeatureModule } from "@weaveforge/core";

/** Shared with me — header route, read-only grants view. */
export const sharingModule: FeatureModule = {
  id: "sharing",
  title: "Shared",
  shell: true,
  // Grants made by other accounts; there is nothing to read offline (plan D3).
  requiresNetwork: true,
  navItems: [],
  routes: [{ path: "/shared", component: "sharing/SharedPage" }],
};
