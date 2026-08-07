import type { FeatureModule } from "@weaveforge/core";

/** Shared with me — header route, read-only grants view. */
export const sharingModule: FeatureModule = {
  id: "sharing",
  title: "Shared",
  shell: true,
  navItems: [],
  routes: [{ path: "/shared", component: "sharing/SharedPage" }],
};
