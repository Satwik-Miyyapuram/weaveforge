import type { FeatureModule } from "@thesis/core";

/** Shared with me — header route, read-only grants view. */
export const sharingModule: FeatureModule = {
  id: "sharing",
  title: "Shared",
  shell: true,
  navItems: [],
  routes: [{ path: "/shared", component: "sharing/SharedPage" }],
};
