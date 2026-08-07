import type { WebWeaveForgePlugin } from "@/deployment/app-config";
import { timerPluginModule } from "./module";

/** Example deploy plugin — enable in `weaveforge.config.ts`. */
export function exampleTimerPlugin(): WebWeaveForgePlugin {
  return {
    id: "example-timer",
    modules: [timerPluginModule],
  };
}

export { timerPluginModule } from "./module";
