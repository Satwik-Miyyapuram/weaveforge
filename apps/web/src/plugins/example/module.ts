import type { WebFeatureModule } from "@/plugins/web-feature-module";

export const timerPluginModule: WebFeatureModule = {
  id: "timer-plugin",
  title: "Timer",
  navGroup: "plan",
  navItems: [{ key: "timer-plugin", label: "Timer", path: "/timer", icon: "clock" }],
  routes: [{ path: "/timer", component: "plugins/example/TimerPluginScreen" }],
};
