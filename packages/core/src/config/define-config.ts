import type { ThesisTrackerPlugin } from "./plugin.js";
import type { AiToolName } from "../features/ai-assistant/domain/ai-types.js";

/**
 * Optional deploy-time allowlists. Omit a list to keep the default built-ins;
 * provide one to expose only the named components in that category.
 */
export interface BuiltinSelection {
  readonly features?: readonly string[];
  readonly integrations?: readonly string[];
}

export interface McpSelection {
  /** Set false to omit the MCP routes, tools, and browser proposal executors. */
  readonly enabled?: boolean;
  /** Optional compile-time allowlist for the generated MCP manifest. */
  readonly tools?: readonly AiToolName[];
}

export interface ThesisTrackerConfig {
  readonly plugins?: readonly ThesisTrackerPlugin[];
  readonly builtins?: BuiltinSelection;
  readonly mcp?: McpSelection;
}

/** Root config helper for `thesis-tracker.config.ts`. */
export function defineConfig(config: ThesisTrackerConfig): ThesisTrackerConfig {
  return config;
}
