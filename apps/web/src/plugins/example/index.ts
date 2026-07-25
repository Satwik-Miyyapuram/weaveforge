import type { WebThesisTrackerPlugin } from "@/deployment/app-config";
import { timerPluginModule } from "./module";

/** Example deploy plugin — enable in `thesis-tracker.config.ts`. */
export function exampleTimerPlugin(): WebThesisTrackerPlugin {
  return {
    id: "example-timer",
    modules: [timerPluginModule],
  };
}

export { timerPluginModule } from "./module";
